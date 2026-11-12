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
const TABLES = new Set(["pages", "tasks", "cards", "files", "databases", "slots", "grades", "templates", "links", "page_files"]);

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
`);

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

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!body || typeof body !== "object") throw new Error();
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
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type" };
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };
  try {
    const path = new URL(req.url, "http://x").pathname;
    if (!path.startsWith("/api/")) {
      if (STATIC_DIR && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(req, res);
      throw new HttpError(404, "not found");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204, { ...cors, "Access-Control-Max-Age": "86400" }).end();
    if (path === "/api/health") return send(200, { ok: true, registration: REGISTRATION });
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
    throw new HttpError(404, "not found");
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return void res.end();
    send(err instanceof HttpError ? err.status : 500, { error: err instanceof HttpError ? err.message : "server error" });
  }
});

server.listen(PORT, () => console.log(`Nautila : serveur à l'écoute sur le port ${PORT} (inscriptions : ${REGISTRATION})`));
