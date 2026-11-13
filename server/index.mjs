// Serveur de synchronisation de Nautila.
//
// Chaque compte possède un ensemble de « lignes » (table, identifiant, données
// JSON). Le dernier écrivain gagne, sauf pour le contenu des pages (Yjs), qui
// est fusionné. Le serveur peut aussi servir l'application web (STATIC_DIR).
import { createServer } from "node:http";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";

const PORT = Number(process.env.PORT ?? 8787);
const DATA_FILE = process.env.DATA_FILE ?? "./nautila-server.db";
const STATIC_DIR = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : null;
/** "open" : tout le monde peut créer un compte ; "invite" : avec INVITE_CODE ; "closed" : personne. */
const REGISTRATION = process.env.REGISTRATION ?? (process.env.INVITE_CODE ? "invite" : "open");
const INVITE_CODE = process.env.INVITE_CODE ?? "";
const MAX_USER_BYTES = Number(process.env.MAX_USER_MB ?? 1024) * 1024 * 1024;
const MAX_BODY = 48 * 1024 * 1024;
const PULL_BYTES = 4 * 1024 * 1024;
const TABLES = new Set(["pages", "tasks", "cards", "files", "databases", "slots", "grades", "templates", "links", "page_files", "quizzes", "refs"]);

const db = new DatabaseSync(DATA_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS records (
    user_id INTEGER NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL,
    data TEXT, at INTEGER NOT NULL, seq INTEGER NOT NULL,
    PRIMARY KEY (user_id, tbl, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records (user_id, seq);
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT NOT NULL, ydoc TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);

try {
  db.exec("ALTER TABLE shares ADD COLUMN public INTEGER NOT NULL DEFAULT 0");
} catch {
  /* colonne déjà présente */
}

const q = {
  user: db.prepare("SELECT * FROM users WHERE username = ?"),
  addUser: db.prepare("INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)"),
  addToken: db.prepare("INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)"),
  dropToken: db.prepare("DELETE FROM tokens WHERE hash = ?"),
  byToken: db.prepare("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?"),
  record: db.prepare("SELECT data, at FROM records WHERE user_id = ? AND tbl = ? AND id = ?"),
  put: db.prepare(
    `INSERT INTO records (user_id, tbl, id, data, at, seq) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, tbl, id) DO UPDATE SET data = excluded.data, at = excluded.at, seq = excluded.seq`,
  ),
  setSeq: db.prepare("UPDATE users SET seq = ? WHERE id = ?"),
  since: db.prepare("SELECT tbl, id, data, at, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 500"),
  share: db.prepare("SELECT * FROM shares WHERE id = ?"),
  addShare: db.prepare("INSERT INTO shares (id, owner_id, title, ydoc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"),
  saveShare: db.prepare("UPDATE shares SET ydoc = ?, updated_at = ? WHERE id = ?"),
  dropShare: db.prepare("DELETE FROM shares WHERE id = ?"),
  setPublic: db.prepare("UPDATE shares SET public = ? WHERE id = ?"),
  fileOf: db.prepare("SELECT data FROM records WHERE user_id = ? AND tbl = 'files' AND id = ? AND data IS NOT NULL"),
  records: db.prepare("SELECT id, data FROM records WHERE user_id = ? AND tbl = ? AND data IS NOT NULL"),
  usage: db.prepare("SELECT COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM records WHERE user_id = ?"),
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString("hex");

function issueToken(userId) {
  const token = randomBytes(32).toString("base64url");
  q.addToken.run(sha(token), userId, Date.now());
  return token;
}

// Limite les essais de mot de passe : dix par quart d'heure et par adresse.
const attempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.start > 15 * 60_000) return void attempts.set(ip, { start: now, count: 1 });
  if (++entry.count > 10) throw new HttpError(429, "too many attempts");
}

function credentials(body) {
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "invalid username");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "invalid password");
  return { username, password };
}

function register(body) {
  if (REGISTRATION === "closed") throw new HttpError(403, "registration closed");
  if (REGISTRATION === "invite" && body.invite !== INVITE_CODE) throw new HttpError(403, "invalid invite");
  const { username, password } = credentials(body);
  if (q.user.get(username)) throw new HttpError(409, "username taken");
  const salt = randomBytes(16).toString("hex");
  const { lastInsertRowid } = q.addUser.run(username, salt, hashPassword(password, salt), Date.now());
  return { token: issueToken(Number(lastInsertRowid)), username };
}

function login(body) {
  const { username, password } = credentials(body);
  const user = q.user.get(username);
  // Même travail que le compte existe ou non, pour ne pas révéler son existence.
  const hash = Buffer.from(hashPassword(password, user?.salt ?? "0".repeat(32)), "hex");
  if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, "hex"))) throw new HttpError(401, "bad credentials");
  return { token: issueToken(user.id), username };
}

const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/** Fusionne deux états Yjs ; renvoie `existing` tel quel si `incoming` n'apporte rien. */
function mergeDocs(existing, incoming) {
  if (!incoming || incoming === existing) return existing;
  if (!existing) return incoming;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, b64(existing));
  const before = Y.encodeStateAsUpdate(doc);
  Y.applyUpdate(doc, b64(incoming));
  const after = Y.encodeStateAsUpdate(doc);
  return Buffer.compare(before, after) === 0 ? existing : Buffer.from(after).toString("base64");
}

function sync(user, body) {
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const now = Date.now();
  let seq = user.seq;
  /** Lignes enregistrées telles que reçues : inutile de les renvoyer à l'expéditeur. */
  const echoed = new Set();

  db.exec("BEGIN IMMEDIATE");
  try {
    let added = 0;
    for (const c of changes) {
      if (!TABLES.has(c?.tbl) || typeof c.id !== "string" || !c.id || c.id.length > 300) throw new HttpError(400, "invalid change");
      if (c.data !== null && (typeof c.data !== "object" || Array.isArray(c.data))) throw new HttpError(400, "invalid change");
      // Une horloge en avance ne doit pas verrouiller une ligne dans le futur.
      const at = Math.min(Number(c.at) || 0, now + 5 * 60_000);
      const existing = q.record.get(user.id, c.tbl, c.id);
      let data = c.data;
      let stamp = at;

      if (c.tbl === "pages" && data && existing?.data) {
        const current = JSON.parse(existing.data);
        const ydoc = mergeDocs(current.ydoc ?? null, data.ydoc ?? null);
        data = at >= existing.at ? { ...data, ydoc } : { ...current, ydoc };
        stamp = Math.max(at, existing.at);
      } else if (existing && at < existing.at) continue;

      const json = data === null ? null : JSON.stringify(data);
      if (existing && existing.data === json && existing.at === stamp) continue;
      added += (json?.length ?? 0) - (existing?.data?.length ?? 0);
      q.put.run(user.id, c.tbl, c.id, json, stamp, ++seq);
      if (json === (c.data === null ? null : JSON.stringify(c.data))) echoed.add(seq);
    }
    if (added > 0 && q.usage.get(user.id).bytes > MAX_USER_BYTES) throw new HttpError(413, "quota exceeded");
    if (seq !== user.seq) q.setSeq.run(seq, user.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const out = [];
  let bytes = 0;
  let cursor = since;
  let more = false;
  for (const row of q.since.all(user.id, since)) {
    if (bytes > PULL_BYTES) {
      more = true;
      break;
    }
    cursor = row.seq;
    if (echoed.has(row.seq)) continue;
    bytes += row.data?.length ?? 0;
    out.push({ tbl: row.tbl, id: row.id, data: row.data === null ? null : JSON.parse(row.data), at: row.at });
  }
  if (!more && cursor < seq && q.since.all(user.id, cursor).length > 0) more = true;
  return { seq: cursor, changes: out, more };
}


// ---------- Pages partagées en direct ----------
// Une page partagée est un document Yjs tenu en mémoire tant que quelqu'un
// l'a ouverte. Toute personne connectée qui possède son identifiant (128 bits
// aléatoires) peut la lire et la modifier.
const rooms = new Map();

function openRoom(id) {
  let room = rooms.get(id);
  if (room) return room;
  const share = q.share.get(id);
  if (!share) throw new HttpError(404, "share not found");
  const doc = new Y.Doc();
  if (share.ydoc) Y.applyUpdate(doc, b64(share.ydoc));
  room = { id, doc, clients: new Map(), dirty: false, timer: null };
  rooms.set(id, room);
  return room;
}

function persistRoom(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (!room.dirty) return;
  room.dirty = false;
  q.saveShare.run(Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64"), Date.now(), room.id);
}

function broadcast(room, except, event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const [conn, res] of room.clients) if (conn !== except) res.write(frame);
}

function createShare(user, body) {
  const id = randomBytes(16).toString("base64url");
  const now = Date.now();
  q.addShare.run(id, user.id, String(body.title ?? "").slice(0, 300), typeof body.ydoc === "string" ? body.ydoc : null, now, now);
  return { id };
}

function shareStream(room, req, res) {
  const conn = randomBytes(8).toString("hex");
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64");
  res.write(`data: ${JSON.stringify({ type: "sync", conn, update: state, peers: room.clients.size })}\n\n`);
  room.clients.set(conn, res);
  broadcast(room, conn, { type: "peers", peers: room.clients.size });
  const beat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(beat);
    room.clients.delete(conn);
    broadcast(room, null, { type: "peers", peers: room.clients.size });
    if (room.clients.size === 0) {
      persistRoom(room);
      rooms.delete(room.id);
    }
  });
}

function shareUpdate(room, body) {
  if (typeof body.update !== "string") throw new HttpError(400, "invalid update");
  Y.applyUpdate(room.doc, b64(body.update));
  room.dirty = true;
  room.timer ??= setTimeout(() => persistRoom(room), 3000);
  broadcast(room, body.conn, { type: "update", update: body.update });
  return { ok: true };
}

// ---------- Connecteur MCP (Claude, Codex…) ----------
// Protocole « Streamable HTTP » sans état : chaque requête JSON-RPC reçoit une réponse JSON.
const uuid = () => randomBytes(16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

/** Écrit une ligne dans les données du compte ; les appareils la recevront à leur prochaine synchronisation. */
function putRecord(user, tbl, id, data) {
  const seq = q.user.get(user.username).seq + 1;
  q.put.run(user.id, tbl, id, JSON.stringify(data), Date.now(), seq);
  q.setSeq.run(seq, user.id);
}

const rowsOf = (user, tbl) => q.records.all(user.id, tbl).map((r) => JSON.parse(r.data));
const livePages = (user) => rowsOf(user, "pages").filter((p) => !p.deleted_at);
const str = (schema = {}) => ({ type: "string", ...schema });

function findPage(user, id) {
  const page = livePages(user).find((p) => p.id === id);
  if (!page) throw new HttpError(404, `Aucune page avec l'identifiant ${id}`);
  return page;
}

const TOOLS = [
  {
    name: "search_notes",
    description: "Cherche un texte dans le titre et le contenu de toutes les notes de l'utilisateur. Renvoie les pages correspondantes avec un extrait.",
    inputSchema: { type: "object", properties: { query: str({ description: "Mots à chercher" }) }, required: ["query"] },
    run(user, { query }) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      return livePages(user)
        .map((p) => {
          const text = `${p.title}\n${p.body ?? ""}`;
          const lower = text.toLowerCase();
          const score = words.filter((w) => lower.includes(w)).length;
          const at = Math.max(0, lower.indexOf(words.find((w) => lower.includes(w)) ?? "") - 80);
          return { id: p.id, title: p.title, kind: p.kind, score, excerpt: text.slice(at, at + 300) };
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
    },
  },
  {
    name: "list_pages",
    description: "Liste toutes les pages (semestres, matières, notes, bases de données) avec leur parent, pour comprendre l'organisation des cours.",
    inputSchema: { type: "object", properties: {} },
    run: (user) => livePages(user).map((p) => ({ id: p.id, title: p.title, kind: p.kind, parent_id: p.parent_id, updated_at: new Date(p.updated_at).toISOString() })),
  },
  {
    name: "read_page",
    description: "Renvoie le texte complet d'une page et ses flashcards.",
    inputSchema: { type: "object", properties: { page_id: str() }, required: ["page_id"] },
    run(user, { page_id }) {
      const page = findPage(user, page_id);
      const cards = rowsOf(user, "cards").filter((c) => c.page_id === page_id).map((c) => ({ front: c.front, back: c.back }));
      return { id: page.id, title: page.title, kind: page.kind, text: page.body ?? page.import_md ?? "", flashcards: cards };
    },
  },
  {
    name: "create_flashcards",
    description: "Ajoute des flashcards (question / réponse) au paquet d'une page. Elles apparaissent dans les révisions de l'application.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: str({ description: "Page (cours) à laquelle rattacher les cartes" }),
        cards: { type: "array", minItems: 1, items: { type: "object", properties: { front: str(), back: str() }, required: ["front", "back"] } },
      },
      required: ["page_id", "cards"],
    },
    run(user, { page_id, cards }) {
      findPage(user, page_id);
      const now = Date.now();
      const due = new Date(now).toISOString();
      const fsrs = JSON.stringify({ due, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: 0 });
      let created = 0;
      for (const c of Array.isArray(cards) ? cards : []) {
        const front = String(c?.front ?? "").trim();
        const back = String(c?.back ?? "").trim();
        if (!front || !back) continue;
        const id = `extra:${uuid()}`;
        putRecord(user, "cards", id, { id, page_id, front, back, fsrs, due: now, created_at: now });
        created++;
      }
      return { created };
    },
  },
  {
    name: "create_quiz",
    description: "Crée un quiz à choix multiples, jouable dans l'écran Révisions de l'application.",
    inputSchema: {
      type: "object",
      properties: {
        title: str(),
        page_id: str({ description: "Page (cours) concernée, facultatif" }),
        questions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              question: str(),
              choices: { type: "array", minItems: 2, items: str() },
              answer: { type: "integer", description: "Indice (à partir de 0) de la bonne réponse dans choices" },
              explanation: str({ description: "Explication affichée après la réponse, facultatif" }),
            },
            required: ["question", "choices", "answer"],
          },
        },
      },
      required: ["title", "questions"],
    },
    run(user, { title, page_id, questions }) {
      if (page_id) findPage(user, page_id);
      const clean = (Array.isArray(questions) ? questions : [])
        .map((x) => ({
          question: String(x?.question ?? "").trim(),
          choices: (Array.isArray(x?.choices) ? x.choices : []).map(String),
          answer: Number(x?.answer),
          explanation: x?.explanation ? String(x.explanation) : "",
        }))
        .filter((x) => x.question && x.choices.length >= 2 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.choices.length);
      if (clean.length === 0) throw new HttpError(400, "Aucune question valide");
      const id = uuid();
      putRecord(user, "quizzes", id, { id, page_id: page_id ?? null, title: String(title).slice(0, 200), questions: JSON.stringify(clean), created_at: Date.now() });
      return { id, questions: clean.length };
    },
  },
  {
    name: "create_page",
    description: "Crée une nouvelle page de notes à partir de Markdown (fiche de révision, résumé…). Le contenu est mis en forme à la première ouverture dans l'application.",
    inputSchema: {
      type: "object",
      properties: { title: str(), markdown: str(), parent_id: str({ description: "Page parente, facultatif" }) },
      required: ["title", "markdown"],
    },
    run(user, { title, markdown, parent_id }) {
      if (parent_id) findPage(user, parent_id);
      const id = uuid();
      const now = Date.now();
      putRecord(user, "pages", id, {
        id, parent_id: parent_id ?? null, kind: "note", title: String(title).slice(0, 300), icon: null, position: now,
        ydoc: null, body: String(markdown), import_md: String(markdown), created_at: now, updated_at: now, deleted_at: null,
        favorite: 0, full_width: 0, cover: null, locked: 0, font: "sans", small_text: 0, props: null, share_id: null,
      });
      return { id };
    },
  },
  {
    name: "list_tasks",
    description: "Liste les devoirs et examens avec leur échéance.",
    inputSchema: { type: "object", properties: {} },
    run: (user) => rowsOf(user, "tasks").map((t) => ({ title: t.title, kind: t.kind, done: !!t.done, due: t.due_at ? new Date(t.due_at).toISOString().slice(0, 10) : null, course_id: t.course_id })),
  },
  {
    name: "list_files",
    description: "Liste les fichiers joints aux notes (images, PDF, audio).",
    inputSchema: { type: "object", properties: {} },
    run: (user) => rowsOf(user, "files").map((f) => ({ id: f.id, name: f.name, mime: f.mime, bytes: Math.round((f.data.length * 3) / 4) })),
  },
  {
    name: "get_file",
    description: "Renvoie le contenu d'un fichier joint (image ou document de moins de 5 Mo).",
    inputSchema: { type: "object", properties: { file_id: str() }, required: ["file_id"] },
    run(user, { file_id }) {
      const file = rowsOf(user, "files").find((f) => f.id === file_id);
      if (!file) throw new HttpError(404, "Fichier introuvable");
      if (file.data.length > 7_000_000) throw new HttpError(413, "Fichier trop volumineux pour être transmis");
      return file.mime.startsWith("image/")
        ? { content: [{ type: "image", data: file.data, mimeType: file.mime }] }
        : { content: [{ type: "resource", resource: { uri: `nautila://file/${file.id}`, mimeType: file.mime, blob: file.data } }] };
    },
  },
];

function mcpMessage(user, msg) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "invalid request");
  if (msg.id === undefined) return null; // notification : pas de réponse
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nautila", version: "0.1.0" },
        instructions: "Notes de cours, flashcards, quiz et devoirs de l'utilisateur dans Nautila. Lis les pages avant de créer des cartes ou des quiz à partir de leur contenu.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, "unknown tool");
      try {
        const result = tool.run(user, msg.params.arguments ?? {});
        return reply(result?.content ? result : { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        if (!(err instanceof HttpError)) console.error(err);
        return reply({ content: [{ type: "text", text: err instanceof HttpError ? err.message : "Erreur interne" }], isError: true });
      }
    }
    default:
      return fail(-32601, "method not found");
  }
}

async function readJson(req, allowArray = false) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object" || (Array.isArray(body) && !allowArray)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function authenticate(req) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
  const user = token && q.byToken.get(sha(token));
  if (!user) throw new HttpError(401, "unauthorized");
  return { user, token };
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
};

async function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(STATIC_DIR, path));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) throw new HttpError(403, "forbidden");
  const found = await stat(file).then((s) => s.isFile(), () => false);
  // Toute adresse inconnue renvoie l'application (elle gère ses propres routes).
  if (!found) file = join(STATIC_DIR, "index.html");
  const body = await readFile(file).catch(() => null);
  if (!body) throw new HttpError(404, "not found");
  res.writeHead(200, {
    "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
    "Cache-Control": path.startsWith("/assets/") && found ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  };
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  try {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/mcp" || path.startsWith("/mcp/")) {
      if (req.method === "OPTIONS") return void res.writeHead(204, { ...cors, "Access-Control-Max-Age": "86400" }).end();
      if (req.method !== "POST") throw new HttpError(405, "method not allowed");
      // Le jeton vient de l'en-tête Authorization, ou de l'adresse (/mcp/<jeton>) pour les clients sans en-tête.
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? path.slice(5);
      const user = token && q.byToken.get(sha(token));
      if (!user) throw new HttpError(401, "unauthorized");
      const body = await readJson(req, true);
      const out = Array.isArray(body) ? body.map((m) => mcpMessage(user, m)).filter(Boolean) : mcpMessage(user, body);
      if (out === null || (Array.isArray(out) && out.length === 0)) return void res.writeHead(202, cors).end();
      return send(200, out);
    }
    if (!path.startsWith("/api/")) {
      if (STATIC_DIR && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(req, res);
      throw new HttpError(404, "not found");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204, { ...cors, "Access-Control-Max-Age": "86400" }).end();
    if (path === "/api/health") return send(200, { ok: true, registration: REGISTRATION });
    // Page publique : lecture seule, sans compte. Seuls le contenu et les fichiers qu'il utilise sont servis.
    const pub = /^\/api\/public\/([\w-]+)(?:\/file\/([\w-]+))?$/.exec(path);
    if (pub && req.method === "GET") {
      const row = q.share.get(pub[1]);
      if (!row?.public) throw new HttpError(404, "not found");
      const room = rooms.get(row.id);
      const ydoc = room ? Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64") : row.ydoc;
      if (!pub[2]) return send(200, { title: row.title, ydoc });
      const doc = room?.doc ?? new Y.Doc();
      if (!room && ydoc) Y.applyUpdate(doc, b64(ydoc));
      if (!doc.getXmlFragment("doc").toString().includes(pub[2])) throw new HttpError(404, "not found");
      const record = q.fileOf.get(row.owner_id, pub[2]);
      if (!record) throw new HttpError(404, "not found");
      const file = JSON.parse(record.data);
      res.writeHead(200, { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600", ...cors });
      return void res.end(Buffer.from(file.data, "base64"));
    }
    const stream = /^\/api\/share\/([\w-]+)\/stream$/.exec(path);
    if (stream && req.method === "GET") {
      authenticate(req);
      return shareStream(openRoom(stream[1]), req, res);
    }
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ?? req.socket.remoteAddress;
    if (path === "/api/register" || path === "/api/login") {
      throttle(ip);
      const body = await readJson(req);
      return send(200, path === "/api/register" ? register(body) : login(body));
    }
    const { user, token } = authenticate(req);
    if (path === "/api/logout") {
      q.dropToken.run(sha(token));
      return send(200, { ok: true });
    }
    if (path === "/api/sync") return send(200, sync(user, await readJson(req)));
    if (path === "/api/token") return send(200, { token: issueToken(user.id) });
    if (path === "/api/share") return send(200, createShare(user, await readJson(req)));
    const share = /^\/api\/share\/([\w-]+)(?:\/(update|awareness|delete|public))?$/.exec(path);
    if (share) {
      const [, id, action] = share;
      if (action === "delete") {
        const row = q.share.get(id);
        if (!row) throw new HttpError(404, "share not found");
        if (row.owner_id !== user.id) throw new HttpError(403, "forbidden");
        const room = rooms.get(id);
        if (room) broadcast(room, null, { type: "closed" });
        rooms.delete(id);
        q.dropShare.run(id);
        return send(200, { ok: true });
      }
      if (action === "public") {
        const row = q.share.get(id);
        if (!row) throw new HttpError(404, "share not found");
        if (row.owner_id !== user.id) throw new HttpError(403, "forbidden");
        const enabled = (await readJson(req)).public === true;
        q.setPublic.run(enabled ? 1 : 0, id);
        return send(200, { public: enabled });
      }
      const room = openRoom(id);
      const body = await readJson(req);
      if (action === "update") return send(200, shareUpdate(room, body));
      if (action === "awareness") {
        if (typeof body.update === "string") broadcast(room, body.conn, { type: "awareness", update: body.update });
        return send(200, { ok: true });
      }
      const row = q.share.get(id);
      return send(200, { title: row.title, owner: row.owner_id === user.id, public: !!row.public, ydoc: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64") });
    }
    throw new HttpError(404, "not found");
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return void res.end();
    send(err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : "server error" });
  }
});

// À l'arrêt, les pages partagées ouvertes sont enregistrées avant de quitter.
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    for (const room of rooms.values()) persistRoom(room);
    process.exit(0);
  });

server.listen(PORT, () => console.log(`Nautila : serveur à l'écoute sur le port ${PORT} (inscriptions : ${REGISTRATION})`));
