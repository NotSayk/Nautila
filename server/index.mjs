// Serveur de synchronisation de Nautila.
//
// Chaque compte possède un ensemble de « lignes » (table, identifiant, données
// JSON). Le dernier écrivain gagne, sauf pour le contenu des pages (Yjs), qui
// est fusionné. Le serveur peut aussi servir l'application web (STATIC_DIR).
import { createServer } from "node:http";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import * as Y from "yjs";

const scrypt = promisify(scryptCallback);
const env = process.env;
const MB = 1024 * 1024;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** Nombre lu dans l'environnement, ou la valeur par défaut s'il est absent ou invalide. */
const num = (value, fallback) =>
  value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;

const PORT = num(env.PORT, 8787);
const DATA_FILE = env.DATA_FILE ?? "./nautila-server.db";
const STATIC_DIR = env.STATIC_DIR ? resolve(env.STATIC_DIR) : null;
const INVITE_CODE = (env.INVITE_CODE ?? "").trim();
/** "open" : tout le monde peut créer un compte ; "invite" : avec INVITE_CODE ; "closed" : personne. */
const REGISTRATION = registrationMode();
const MAX_USER_BYTES = num(env.MAX_USER_MB, 1024) * MB;
/** Pages partagées par compte, et taille maximale du document d'une page partagée. */
const MAX_SHARES = num(env.MAX_SHARES, 200);
const MAX_SHARE_BYTES = num(env.MAX_SHARE_MB, 64) * MB;
/** Un jeton inutilisé pendant ce délai expire (l'appareil devra se reconnecter). */
const TOKEN_TTL = num(env.TOKEN_TTL_DAYS, 90) * DAY;
/** Les suppressions plus anciennes sont oubliées (0 : jamais). */
const TOMBSTONE_TTL = num(env.TOMBSTONE_DAYS, 365) * DAY;
/** Nombre de relais (Caddy, nginx…) devant le serveur : X-Forwarded-For n'est lu que s'il est défini. */
const PROXY_HOPS = /^(true|yes|on)$/i.test(env.TRUST_PROXY ?? "")
  ? 1
  : Math.max(0, Math.floor(num(env.TRUST_PROXY, 0)));
/**
 * Origines autorisées à appeler l'API depuis un navigateur. Par défaut toutes : l'API
 * s'authentifie par un jeton dans l'en-tête Authorization (jamais par cookie), donc un
 * autre site ne peut rien lire ni modifier sans ce jeton. CORS_ORIGINS restreint la liste ;
 * l'application de bureau (Tauri) reste toujours autorisée.
 */
const CORS_ORIGINS =
  !env.CORS_ORIGINS || env.CORS_ORIGINS.trim() === "*"
    ? null
    : new Set([
        ...env.CORS_ORIGINS.split(",")
          .map((o) => o.trim().replace(/\/+$/, ""))
          .filter(Boolean),
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ]);

const MAX_BODY = 48 * MB;
const AUTH_BODY = 8 * 1024;
const SMALL_BODY = 64 * 1024;
const SHARE_BODY = 16 * MB;
const MCP_BODY = 4 * MB;
const PULL_BYTES = 4 * MB;
const TABLES = new Set([
  "pages",
  "tasks",
  "cards",
  "files",
  "databases",
  "slots",
  "grades",
  "templates",
  "links",
  "page_files",
  "quizzes",
  "refs",
  "events",
]);

function registrationMode() {
  const mode = env.REGISTRATION ?? (INVITE_CODE ? "invite" : "open");
  if (!["open", "invite", "closed"].includes(mode)) {
    console.warn(`ATTENTION : REGISTRATION=${mode} n'est pas reconnu (open, invite ou closed) : inscriptions fermées.`);
    return "closed";
  }
  // Le code d'exemple de deploy/docker-compose.yml est public : il n'ouvre pas les inscriptions.
  const placeholder = ["change-moi", "change-me", "changeme"].includes(INVITE_CODE.toLowerCase());
  if (mode === "invite" && (!INVITE_CODE || placeholder)) {
    console.warn(
      "ATTENTION : INVITE_CODE est vide ou vaut encore la valeur d'exemple : inscriptions FERMÉES. " +
        "Choisis un vrai code (fichier .env ou docker-compose.yml) puis redémarre le serveur.",
    );
    return "closed";
  }
  return mode;
}

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

// Migrations : chacune peut être rejouée sans effet sur une base déjà à jour.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
for (const [table, column, definition] of [
  ["shares", "public", "INTEGER NOT NULL DEFAULT 0"],
  ["shares", "access", "TEXT NOT NULL DEFAULT 'edit'"],
  // "session" : un appareil ; "mcp" : un connecteur IA, accepté seulement sur /mcp.
  ["tokens", "kind", "TEXT NOT NULL DEFAULT 'session'"],
  ["tokens", "last_used", "INTEGER"],
])
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
// Les jetons d'avant l'expiration repartent d'aujourd'hui, pour ne déconnecter personne à la mise à jour.
db.prepare("UPDATE tokens SET last_used = ? WHERE last_used IS NULL").run(Date.now());
// Participants d'une page partagée. `role` vide : le participant suit le réglage général de la page.
db.exec(`
  CREATE TABLE IF NOT EXISTS share_members (
    share_id TEXT NOT NULL, user_id INTEGER NOT NULL, role TEXT, joined_at INTEGER NOT NULL,
    PRIMARY KEY (share_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS tokens_user ON tokens (user_id);
  CREATE INDEX IF NOT EXISTS shares_owner ON shares (owner_id);
  CREATE INDEX IF NOT EXISTS records_tombstones ON records (at) WHERE data IS NULL;
`);

/** Lignes vivantes d'une table du compte, sans lire leur contenu complet. */
const liveRows = (tbl, columns, extra = "") =>
  db.prepare(`SELECT ${columns} FROM records WHERE user_id = ? AND tbl = '${tbl}' AND data IS NOT NULL ${extra}`);
const PAGE_COLUMNS = `id, json_extract(data, '$.title') AS title, json_extract(data, '$.kind') AS kind`;
const LIVE_PAGE = "AND json_extract(data, '$.deleted_at') IS NULL";

const q = {
  user: db.prepare("SELECT * FROM users WHERE username = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  addUser: db.prepare("INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)"),
  setPassword: db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?"),
  seq: db.prepare("SELECT seq FROM users WHERE id = ?"),
  addToken: db.prepare("INSERT INTO tokens (hash, user_id, created_at, kind, last_used) VALUES (?, ?, ?, ?, ?)"),
  dropToken: db.prepare("DELETE FROM tokens WHERE hash = ?"),
  touchToken: db.prepare("UPDATE tokens SET last_used = ? WHERE hash = ?"),
  byToken: db.prepare(
    `SELECT u.id, u.username, t.hash AS token_hash, t.kind AS token_kind, t.last_used AS token_used
     FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?`,
  ),
  dropOtherTokens: db.prepare("DELETE FROM tokens WHERE user_id = ? AND hash != ?"),
  dropOtherSessions: db.prepare("DELETE FROM tokens WHERE user_id = ? AND hash != ? AND kind = 'session'"),
  mcpTokens: db.prepare(
    `SELECT substr(hash, 1, 16) AS id, created_at, last_used FROM tokens
     WHERE user_id = ? AND kind = 'mcp' ORDER BY created_at DESC`,
  ),
  dropMcpToken: db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'mcp' AND substr(hash, 1, 16) = ?"),
  trimMcpTokens: db.prepare(
    `DELETE FROM tokens WHERE user_id = ? AND kind = 'mcp' AND hash NOT IN
       (SELECT hash FROM tokens WHERE user_id = ? AND kind = 'mcp' ORDER BY created_at DESC LIMIT 20)`,
  ),
  expireTokens: db.prepare("DELETE FROM tokens WHERE last_used < ?"),
  record: db.prepare("SELECT data, at FROM records WHERE user_id = ? AND tbl = ? AND id = ?"),
  put: db.prepare(
    `INSERT INTO records (user_id, tbl, id, data, at, seq) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, tbl, id) DO UPDATE SET data = excluded.data, at = excluded.at, seq = excluded.seq`,
  ),
  setSeq: db.prepare("UPDATE users SET seq = ? WHERE id = ?"),
  since: db.prepare("SELECT tbl, id, data, at, seq FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 500"),
  after: db.prepare("SELECT 1 FROM records WHERE user_id = ? AND seq > ? LIMIT 1"),
  purgeTombstones: db.prepare("DELETE FROM records WHERE data IS NULL AND at < ?"),
  share: db.prepare("SELECT * FROM shares WHERE id = ?"),
  shareCount: db.prepare("SELECT COUNT(*) AS n FROM shares WHERE owner_id = ?"),
  addShare: db.prepare(
    "INSERT INTO shares (id, owner_id, title, ydoc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ),
  saveShare: db.prepare("UPDATE shares SET ydoc = ?, updated_at = ? WHERE id = ?"),
  dropShare: db.prepare("DELETE FROM shares WHERE id = ?"),
  setPublic: db.prepare("UPDATE shares SET public = ? WHERE id = ?"),
  setAccess: db.prepare("UPDATE shares SET access = ? WHERE id = ?"),
  member: db.prepare("SELECT role FROM share_members WHERE share_id = ? AND user_id = ?"),
  addMember: db.prepare(
    "INSERT OR IGNORE INTO share_members (share_id, user_id, role, joined_at) VALUES (?, ?, NULL, ?)",
  ),
  setMember: db.prepare("UPDATE share_members SET role = ? WHERE share_id = ? AND user_id = ?"),
  members: db.prepare(
    `SELECT m.user_id AS id, u.username, m.role FROM share_members m JOIN users u ON u.id = m.user_id
     WHERE m.share_id = ? ORDER BY m.joined_at`,
  ),
  dropMembers: db.prepare("DELETE FROM share_members WHERE share_id = ?"),
  fileOf: db.prepare("SELECT data FROM records WHERE user_id = ? AND tbl = 'files' AND id = ? AND data IS NOT NULL"),
  // Fichier d'une page partagée : il appartient au propriétaire ou à l'un des participants qui l'a ajouté.
  sharedFile: db.prepare(
    `SELECT data FROM records WHERE tbl = 'files' AND id = ? AND data IS NOT NULL AND (user_id = ? OR user_id IN
       (SELECT user_id FROM share_members WHERE share_id = ? AND (role IS NULL OR role != 'none'))) LIMIT 1`,
  ),
  // Ce qui compte dans l'espace d'un compte : ses lignes et les documents des pages qu'il partage.
  usage: db.prepare(
    `SELECT (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM records WHERE user_id = ?1)
          + (SELECT COALESCE(SUM(LENGTH(ydoc)), 0) FROM shares WHERE owner_id = ?1) AS bytes`,
  ),
  page: db.prepare("SELECT data FROM records WHERE user_id = ? AND tbl = 'pages' AND id = ? AND data IS NOT NULL"),
  pageList: liveRows(
    "pages",
    `${PAGE_COLUMNS}, json_extract(data, '$.parent_id') AS parent_id, json_extract(data, '$.updated_at') AS updated_at`,
    LIVE_PAGE,
  ),
  pageTexts: liveRows("pages", `${PAGE_COLUMNS}, json_extract(data, '$.body') AS body`, LIVE_PAGE),
  cardsOf: liveRows(
    "cards",
    "json_extract(data, '$.front') AS front, json_extract(data, '$.back') AS back",
    "AND json_extract(data, '$.page_id') = ?",
  ),
  tasks: liveRows("tasks", "data"),
  fileList: liveRows(
    "files",
    `id, json_extract(data, '$.name') AS name, json_extract(data, '$.mime') AS mime,
     LENGTH(json_extract(data, '$.data')) AS size`,
  ),
};

const usageOf = (userId) => q.usage.get(userId).bytes;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const hashPassword = async (password, salt) => await scrypt(password, salt, 64);
/** Comparaison en temps constant de deux chaînes quelconques. */
const safeEqual = (a, b) =>
  timingSafeEqual(createHash("sha256").update(String(a)).digest(), createHash("sha256").update(String(b)).digest());

function issueToken(userId, kind = "session") {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  q.addToken.run(sha(token), userId, now, kind, now);
  return token;
}

/** Compteurs par fenêtre fixe, tenus en mémoire et purgés régulièrement. */
class Counter {
  constructor(window, max) {
    this.window = window;
    this.max = max;
    this.map = new Map();
  }
  entry(key, now) {
    const entry = this.map.get(key);
    return entry && now - entry.start < this.window ? entry : null;
  }
  /** Vrai si la clé a atteint son plafond sur la fenêtre en cours. */
  over(key, now = Date.now()) {
    return (this.entry(key, now)?.count ?? 0) >= this.max;
  }
  hit(key, now = Date.now()) {
    const entry = this.entry(key, now);
    if (entry) entry.count++;
    else {
      if (this.map.size > 100_000) this.purge(now);
      this.map.set(key, { start: now, count: 1 });
    }
  }
  /** Compte un passage ; faux si le plafond est dépassé. */
  take(key, now = Date.now()) {
    this.hit(key, now);
    return this.entry(key, now).count <= this.max;
  }
  clear(key) {
    this.map.delete(key);
  }
  purge(now = Date.now()) {
    for (const [key, entry] of this.map) if (now - entry.start >= this.window) this.map.delete(key);
  }
}

// Essais de mot de passe : seuls les échecs comptent, par adresse et par identifiant.
const ipFailures = new Counter(15 * MINUTE, num(env.LOGIN_MAX_PER_IP, 30));
const userFailures = new Counter(15 * MINUTE, num(env.LOGIN_MAX_PER_USER, 10));
const publicHits = new Counter(MINUTE, num(env.PUBLIC_MAX_PER_MINUTE, 600));
const mcpHits = new Counter(MINUTE, num(env.MCP_MAX_PER_MINUTE, 240));
const COUNTERS = [ipFailures, userFailures, publicHits, mcpHits];

function guard(ip, username) {
  if (ipFailures.over(ip) || (username && userFailures.over(username))) throw new HttpError(429, "too many attempts");
}
function failed(ip, username) {
  ipFailures.hit(ip);
  if (username) userFailures.hit(username);
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;
function credentials(body) {
  const username = String(body.username ?? "")
    .trim()
    .toLowerCase();
  const password = String(body.password ?? "");
  if (!USERNAME.test(username)) throw new HttpError(400, "invalid username");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "invalid password");
  return { username, password };
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "motdepasse",
  "motdepasse1",
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "azertyui",
  "azertyuiop",
  "azerty123",
  "qwertyui",
  "qwertyuiop",
  "qwerty123",
  "abcdefgh",
  "abc12345",
  "iloveyou",
  "jetaime1",
  "bonjour1",
  "bonjour123",
  "soleil123",
  "nautila1",
  "nautila123",
]);
/** Mot de passe trop facile à deviner : refusé à l'inscription et au changement (pas à la connexion). */
function weakPassword(username, password) {
  const lower = password.toLowerCase();
  return (
    new Set(password).size < 4 ||
    COMMON_PASSWORDS.has(lower) ||
    lower === username ||
    (username.length >= 4 && lower.includes(username))
  );
}

async function register(body, ip) {
  if (REGISTRATION === "closed") throw new HttpError(403, "registration closed");
  guard(ip);
  if (REGISTRATION === "invite" && !safeEqual(String(body.invite ?? "").trim(), INVITE_CODE)) {
    failed(ip);
    throw new HttpError(403, "invalid invite");
  }
  const { username, password } = credentials(body);
  if (weakPassword(username, password)) throw new HttpError(400, "weak password");
  if (q.user.get(username)) {
    failed(ip);
    throw new HttpError(409, "username taken");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = (await hashPassword(password, salt)).toString("hex");
  let id;
  try {
    id = Number(q.addUser.run(username, salt, hash, Date.now()).lastInsertRowid);
  } catch {
    throw new HttpError(409, "username taken"); // créé entre-temps par une requête concurrente
  }
  return { token: issueToken(id), username };
}

// Sel et empreinte factices : un identifiant inconnu coûte le même calcul qu'un vrai.
const DUMMY_SALT = randomBytes(16).toString("hex");
const DUMMY_HASH = randomBytes(64);

/** Vérifie un mot de passe ; la réponse et le temps de calcul ne dépendent pas de l'existence du compte. */
async function checkPassword(user, password) {
  const hash = await hashPassword(password, user?.salt ?? DUMMY_SALT);
  const expected = user ? Buffer.from(user.hash, "hex") : DUMMY_HASH;
  return expected.length === hash.length && timingSafeEqual(hash, expected) && !!user;
}

async function login(body, ip) {
  const { username, password } = credentials(body);
  guard(ip, username);
  const user = q.user.get(username);
  if (!(await checkPassword(user, password))) {
    failed(ip, username);
    throw new HttpError(401, "bad credentials");
  }
  userFailures.clear(username);
  return { token: issueToken(user.id), username };
}

/** Change le mot de passe et ferme toutes les autres sessions (appareils et jetons MCP). */
async function changePassword(auth, body, ip) {
  const { user } = auth;
  guard(ip, user.username);
  const current = String(body.current ?? "").slice(0, 200);
  const password = String(body.password ?? "");
  if (password.length < 8 || password.length > 200) throw new HttpError(400, "invalid password");
  if (weakPassword(user.username, password)) throw new HttpError(400, "weak password");
  if (!(await checkPassword(q.userById.get(user.id), current))) {
    failed(ip, user.username);
    // Pas 401 : l'appareil reste connecté, seul l'ancien mot de passe est faux.
    throw new HttpError(403, "bad credentials");
  }
  const salt = randomBytes(16).toString("hex");
  q.setPassword.run(salt, (await hashPassword(password, salt)).toString("hex"), user.id);
  const { changes } = q.dropOtherTokens.run(user.id, auth.hash);
  return { ok: true, revoked: Number(changes) };
}

const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
/** Vrai si la chaîne est un état ou une mise à jour Yjs lisible. */
function validUpdate(base64) {
  try {
    Y.decodeUpdate(b64(base64));
    return true;
  } catch {
    return false;
  }
}

/** Fusionne deux états Yjs ; renvoie `existing` tel quel si `incoming` n'apporte rien (ou est illisible). */
function mergeDocs(existing, incoming) {
  if (!incoming || incoming === existing) return existing;
  if (!existing) return incoming;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, b64(existing));
  } catch {
    return incoming; // version enregistrée illisible : la nouvelle la remplace
  }
  const before = Y.encodeStateAsUpdate(doc);
  try {
    Y.applyUpdate(doc, b64(incoming));
  } catch {
    return existing;
  }
  const after = Y.encodeStateAsUpdate(doc);
  return Buffer.compare(before, after) === 0 ? existing : Buffer.from(after).toString("base64");
}

/** Écrit des lignes du compte en une transaction, avec des numéros de séquence lus dans celle-ci. */
function transaction(userId, write) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const start = q.seq.get(userId).seq;
    let seq = start;
    const result = write(() => ++seq);
    if (seq !== start) q.setSeq.run(seq, userId);
    db.exec("COMMIT");
    return { result, seq };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function sync(user, body) {
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const now = Date.now();
  /** Lignes enregistrées telles que reçues : inutile de les renvoyer à l'expéditeur. */
  const echoed = new Set();

  const { seq } = transaction(user.id, (next) => {
    let added = 0;
    for (const c of changes) {
      if (!TABLES.has(c?.tbl) || typeof c.id !== "string" || !c.id || c.id.length > 300)
        throw new HttpError(400, "invalid change");
      if (c.data !== null && (typeof c.data !== "object" || Array.isArray(c.data)))
        throw new HttpError(400, "invalid change");
      // Une horloge en avance ne doit pas verrouiller une ligne dans le futur.
      const at = Math.min(Number(c.at) || 0, now + 5 * MINUTE);
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
      const seq = next();
      q.put.run(user.id, c.tbl, c.id, json, stamp, seq);
      if (json === (c.data === null ? null : JSON.stringify(c.data))) echoed.add(seq);
    }
    if (added > 0 && usageOf(user.id) > MAX_USER_BYTES) throw new HttpError(413, "quota exceeded");
  });

  const out = [];
  let bytes = 0;
  let cursor = since;
  let more = false;
  // Lu ligne à ligne : un lot de gros fichiers n'est pas chargé en mémoire d'un coup.
  for (const row of q.since.iterate(user.id, since)) {
    if (bytes > PULL_BYTES) {
      more = true;
      break;
    }
    cursor = row.seq;
    if (echoed.has(row.seq)) continue;
    bytes += row.data?.length ?? 0;
    out.push({ tbl: row.tbl, id: row.id, data: row.data === null ? null : JSON.parse(row.data), at: row.at });
  }
  if (!more && cursor < seq && q.after.get(user.id, cursor)) more = true;
  return { seq: cursor, changes: out, more };
}

// ---------- Pages partagées en direct ----------
// Une page partagée est un document Yjs tenu en mémoire tant que quelqu'un
// l'a ouverte. Toute personne connectée qui possède son identifiant (128 bits
// aléatoires) peut la rejoindre ; le propriétaire décide qui peut modifier.
const rooms = new Map();
/** Flux ouverts par compte, pour qu'un seul compte ne puisse pas épuiser les connexions. */
const streams = new Map();
const MAX_STREAMS = 40;

/**
 * Droit d'un compte sur une page partagée : "owner", "edit", "view" ou "none" (retiré).
 * Le réglage propre au participant l'emporte sur le réglage général de la page.
 * Avec `join`, le compte est inscrit parmi les participants s'il n'y est pas déjà.
 */
function roleOf(share, user, join = false) {
  if (share.owner_id === user.id) return "owner";
  if (join) q.addMember.run(share.id, user.id, Date.now());
  return q.member.get(share.id, user.id)?.role ?? share.access;
}

/** Vérifie le droit d'un compte ; refuse s'il a été retiré, ou s'il ne peut que lire quand `write` est demandé. */
function shareAccess(id, user, { write = false, join = false } = {}) {
  const share = q.share.get(id);
  if (!share) throw new HttpError(404, "share not found");
  const role = roleOf(share, user, join);
  if (role === "none" || (write && role === "view")) throw new HttpError(403, "forbidden");
  return { share, role };
}

/** Page partagée dont `user` est le propriétaire. */
function ownedShare(id, user) {
  const share = q.share.get(id);
  if (!share) throw new HttpError(404, "share not found");
  if (share.owner_id !== user.id) throw new HttpError(403, "forbidden");
  return share;
}

/** Annonce à chaque participant connecté son droit actuel, et coupe ceux qui ont été retirés. */
function refreshRoles(id) {
  const room = rooms.get(id);
  const share = q.share.get(id);
  if (!room || !share) return;
  for (const [conn, client] of room.clients) {
    const role = roleOf(share, client.user);
    client.res.write(`data: ${JSON.stringify({ type: "role", role })}\n\n`);
    if (role === "none") {
      room.clients.delete(conn);
      client.res.end();
    }
  }
}

function openRoom(share) {
  let room = rooms.get(share.id);
  if (!room) {
    const doc = new Y.Doc();
    if (share.ydoc) Y.applyUpdate(doc, b64(share.ydoc));
    room = {
      id: share.id,
      owner: share.owner_id,
      doc,
      clients: new Map(),
      dirty: false,
      timer: null,
      /** Taille approchée du document enregistré, en base64. */
      bytes: share.ydoc?.length ?? 0,
      quota: { at: 0, over: false },
      used: 0,
    };
    rooms.set(share.id, room);
  }
  room.used = Date.now();
  return room;
}

function persistRoom(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (!room.dirty) return;
  room.dirty = false;
  const ydoc = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64");
  room.bytes = ydoc.length;
  q.saveShare.run(ydoc, Date.now(), room.id);
}

function closeRoom(room) {
  persistRoom(room);
  if (rooms.get(room.id) === room) rooms.delete(room.id);
}

function broadcast(room, except, event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const [conn, client] of room.clients) if (conn !== except) client.res.write(frame);
}

function createShare(user, body) {
  if (q.shareCount.get(user.id).n >= MAX_SHARES) throw new HttpError(403, "too many shares");
  const ydoc = typeof body.ydoc === "string" && body.ydoc ? body.ydoc : null;
  if (ydoc && !validUpdate(ydoc)) throw new HttpError(400, "invalid update");
  if (ydoc && ydoc.length > MAX_SHARE_BYTES) throw new HttpError(413, "share too large");
  if (usageOf(user.id) + (ydoc?.length ?? 0) > MAX_USER_BYTES) throw new HttpError(413, "quota exceeded");
  const id = randomBytes(16).toString("base64url");
  const now = Date.now();
  q.addShare.run(id, user.id, String(body.title ?? "").slice(0, 300), ydoc, now, now);
  return { id };
}

function shareStream(room, req, res, user, role, headers) {
  const open = streams.get(user.id) ?? 0;
  if (open >= MAX_STREAMS) throw new HttpError(429, "too many streams");
  streams.set(user.id, open + 1);
  const conn = randomBytes(8).toString("hex");
  res.writeHead(200, {
    ...headers,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64");
  res.write(`data: ${JSON.stringify({ type: "sync", conn, update: state, peers: room.clients.size, role })}\n\n`);
  room.clients.set(conn, { res, user });
  broadcast(room, conn, { type: "peers", peers: room.clients.size });
  const beat = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(beat);
    const left = (streams.get(user.id) ?? 1) - 1;
    if (left > 0) streams.set(user.id, left);
    else streams.delete(user.id);
    room.clients.delete(conn);
    room.used = Date.now();
    broadcast(room, null, { type: "peers", peers: room.clients.size });
    if (room.clients.size === 0) closeRoom(room);
  });
}

/** Document d'une page partagée : celui de la salle ouverte, sinon la dernière version enregistrée. */
function shareDoc(share) {
  const room = rooms.get(share.id);
  if (room) return room.doc;
  const doc = new Y.Doc();
  if (share.ydoc) Y.applyUpdate(doc, b64(share.ydoc));
  return doc;
}

/** Texte du document d'une page partagée, gardé en cache tant qu'il ne change pas. */
const docTexts = new Map();
function shareText(share) {
  const room = rooms.get(share.id);
  if (room) return room.doc.getXmlFragment("doc").toString();
  const cached = docTexts.get(share.id);
  if (cached?.at === share.updated_at) return cached.text;
  const text = shareDoc(share).getXmlFragment("doc").toString();
  if (docTexts.size > 200) docTexts.clear();
  docTexts.set(share.id, { at: share.updated_at, text });
  return text;
}

/** Vrai si le document de la page cite ce fichier (identifiant entier, pas un simple fragment). */
const citesFile = (share, fileId) =>
  fileId.length >= 16 && new RegExp(`(?<![\\w-])${fileId}(?![\\w-])`).test(shareText(share));

/**
 * État des pages partagées d'un appareil, pour les mettre à jour sans les ouvrir :
 * pour chacune, ce qui manque à l'appareil (d'après son vecteur d'état) et le vecteur
 * d'état du serveur, qui lui permet d'envoyer en retour ce que le serveur n'a pas.
 */
function sharesState(user, body) {
  const list = Array.isArray(body.shares) ? body.shares.slice(0, 500) : [];
  return {
    shares: list.map(({ id, sv } = {}) => {
      const share = typeof id === "string" ? q.share.get(id) : null;
      if (!share) return { id, role: "gone" };
      const role = roleOf(share, user);
      if (role === "none") return { id, role };
      const doc = shareDoc(share);
      let vector;
      try {
        vector = typeof sv === "string" && sv ? b64(sv) : undefined;
        if (vector) Y.decodeStateVector(vector);
      } catch {
        vector = undefined;
      }
      const update = Y.encodeStateAsUpdate(doc, vector);
      return {
        id,
        role,
        update: Buffer.from(update).toString("base64"),
        sv: Buffer.from(Y.encodeStateVector(doc)).toString("base64"),
      };
    }),
  };
}

function shareUpdate(room, body) {
  if (typeof body.update !== "string") throw new HttpError(400, "invalid update");
  if (room.bytes + body.update.length > MAX_SHARE_BYTES) throw new HttpError(413, "share too large");
  // L'espace du propriétaire est revérifié au plus une fois par minute.
  const now = Date.now();
  if (now - room.quota.at > MINUTE) room.quota = { at: now, over: usageOf(room.owner) > MAX_USER_BYTES };
  if (room.quota.over) throw new HttpError(413, "quota exceeded");
  const update = b64(body.update);
  try {
    Y.decodeUpdate(update);
  } catch {
    throw new HttpError(400, "invalid update");
  }
  Y.applyUpdate(room.doc, update);
  room.bytes += body.update.length;
  room.dirty = true;
  room.used = now;
  room.timer ??= setTimeout(() => persistRoom(room), 3000);
  broadcast(room, typeof body.conn === "string" ? body.conn : null, { type: "update", update: body.update });
  return { ok: true };
}

// ---------- Connecteur MCP (Claude, Codex…) ----------
// Protocole « Streamable HTTP » sans état : chaque requête JSON-RPC reçoit une réponse JSON.
const uuid = () =>
  randomBytes(16)
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

/** Écrit une ligne dans les données du compte ; les appareils la recevront à leur prochaine synchronisation. */
function putRecord(user, tbl, id, data) {
  const json = JSON.stringify(data);
  transaction(user.id, (next) => {
    if (usageOf(user.id) + json.length > MAX_USER_BYTES)
      throw new HttpError(413, "Espace de stockage du compte dépassé");
    q.put.run(user.id, tbl, id, json, Date.now(), next());
  });
}

const str = (schema = {}) => ({ type: "string", ...schema });
const text = (value, max) => String(value ?? "").slice(0, max);

function findPage(user, id) {
  const row = typeof id === "string" ? q.page.get(user.id, id) : undefined;
  const page = row ? JSON.parse(row.data) : null;
  if (!page || page.deleted_at) throw new HttpError(404, `Aucune page avec l'identifiant ${String(id).slice(0, 100)}`);
  return page;
}

const TOOLS = [
  {
    name: "search_notes",
    description:
      "Cherche un texte dans le titre et le contenu de toutes les notes de l'utilisateur. Renvoie les pages correspondantes avec un extrait.",
    inputSchema: {
      type: "object",
      properties: { query: str({ description: "Mots à chercher" }) },
      required: ["query"],
    },
    run(user, { query }) {
      const words = text(query, 500).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
      const found = [];
      for (const p of q.pageTexts.iterate(user.id)) {
        const content = `${p.title ?? ""}\n${p.body ?? ""}`;
        const lower = content.toLowerCase();
        const score = words.filter((w) => lower.includes(w)).length;
        if (score === 0) continue;
        const at = Math.max(0, lower.indexOf(words.find((w) => lower.includes(w)) ?? "") - 80);
        found.push({ id: p.id, title: p.title, kind: p.kind, score, excerpt: content.slice(at, at + 300) });
      }
      return found.sort((a, b) => b.score - a.score).slice(0, 20);
    },
  },
  {
    name: "list_pages",
    description:
      "Liste toutes les pages (semestres, matières, notes, bases de données) avec leur parent, pour comprendre l'organisation des cours.",
    inputSchema: { type: "object", properties: {} },
    run: (user) =>
      q.pageList.all(user.id).map((p) => ({
        id: p.id,
        title: p.title,
        kind: p.kind,
        parent_id: p.parent_id,
        updated_at: Number.isFinite(p.updated_at) ? new Date(p.updated_at).toISOString() : null,
      })),
  },
  {
    name: "read_page",
    description: "Renvoie le texte complet d'une page et ses flashcards.",
    inputSchema: { type: "object", properties: { page_id: str() }, required: ["page_id"] },
    run(user, { page_id }) {
      const page = findPage(user, page_id);
      return {
        id: page.id,
        title: page.title,
        kind: page.kind,
        text: page.body ?? page.import_md ?? "",
        flashcards: q.cardsOf.all(user.id, page_id),
      };
    },
  },
  {
    name: "create_flashcards",
    description:
      "Ajoute des flashcards (question / réponse) au paquet d'une page. Elles apparaissent dans les révisions de l'application.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: str({ description: "Page (cours) à laquelle rattacher les cartes" }),
        cards: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { front: str(), back: str() }, required: ["front", "back"] },
        },
      },
      required: ["page_id", "cards"],
    },
    run(user, { page_id, cards }) {
      findPage(user, page_id);
      const now = Date.now();
      const due = new Date(now).toISOString();
      const fsrs = JSON.stringify({
        due,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        learning_steps: 0,
        state: 0,
      });
      let created = 0;
      for (const c of Array.isArray(cards) ? cards.slice(0, 500) : []) {
        const front = text(c?.front, 10_000).trim();
        const back = text(c?.back, 10_000).trim();
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
      const clean = (Array.isArray(questions) ? questions.slice(0, 300) : [])
        .map((x) => ({
          question: text(x?.question, 5_000).trim(),
          choices: (Array.isArray(x?.choices) ? x.choices.slice(0, 20) : []).map((c) => text(c, 2_000)),
          answer: Number(x?.answer),
          explanation: x?.explanation ? text(x.explanation, 5_000) : "",
        }))
        .filter(
          (x) =>
            x.question &&
            x.choices.length >= 2 &&
            Number.isInteger(x.answer) &&
            x.answer >= 0 &&
            x.answer < x.choices.length,
        );
      if (clean.length === 0) throw new HttpError(400, "Aucune question valide");
      const id = uuid();
      putRecord(user, "quizzes", id, {
        id,
        page_id: page_id ?? null,
        title: text(title, 200),
        questions: JSON.stringify(clean),
        created_at: Date.now(),
      });
      return { id, questions: clean.length };
    },
  },
  {
    name: "create_page",
    description:
      "Crée une nouvelle page de notes à partir de Markdown (fiche de révision, résumé…). Le contenu est mis en forme à la première ouverture dans l'application.",
    inputSchema: {
      type: "object",
      properties: { title: str(), markdown: str(), parent_id: str({ description: "Page parente, facultatif" }) },
      required: ["title", "markdown"],
    },
    run(user, { title, markdown, parent_id }) {
      if (parent_id) findPage(user, parent_id);
      const id = uuid();
      const now = Date.now();
      const body = text(markdown, 2 * MB);
      putRecord(user, "pages", id, {
        id,
        parent_id: parent_id ?? null,
        kind: "note",
        title: text(title, 300),
        icon: null,
        position: now,
        ydoc: null,
        body,
        import_md: body,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        favorite: 0,
        full_width: 0,
        cover: null,
        locked: 0,
        font: "sans",
        small_text: 0,
        props: null,
        share_id: null,
      });
      return { id };
    },
  },
  {
    name: "list_tasks",
    description: "Liste les devoirs et examens avec leur échéance.",
    inputSchema: { type: "object", properties: {} },
    run: (user) =>
      q.tasks.all(user.id).map(({ data }) => {
        const t = JSON.parse(data);
        return {
          title: t.title,
          kind: t.kind,
          done: !!t.done,
          due: Number.isFinite(t.due_at) ? new Date(t.due_at).toISOString().slice(0, 10) : null,
          course_id: t.course_id,
        };
      }),
  },
  {
    name: "list_files",
    description: "Liste les fichiers joints aux notes (images, PDF, audio).",
    inputSchema: { type: "object", properties: {} },
    run: (user) =>
      q.fileList.all(user.id).map((f) => ({
        id: f.id,
        name: f.name,
        mime: f.mime,
        bytes: Math.round(((f.size ?? 0) * 3) / 4),
      })),
  },
  {
    name: "get_file",
    description: "Renvoie le contenu d'un fichier joint (image ou document de moins de 5 Mo).",
    inputSchema: { type: "object", properties: { file_id: str() }, required: ["file_id"] },
    run(user, { file_id }) {
      const row = typeof file_id === "string" ? q.fileOf.get(user.id, file_id) : undefined;
      if (!row) throw new HttpError(404, "Fichier introuvable");
      if (row.data.length > 7_000_000) throw new HttpError(413, "Fichier trop volumineux pour être transmis");
      const file = JSON.parse(row.data);
      const mime = String(file.mime ?? "application/octet-stream");
      return mime.startsWith("image/")
        ? { content: [{ type: "image", data: file.data, mimeType: mime }] }
        : {
            content: [
              {
                type: "resource",
                resource: { uri: `nautila://file/${file.id}`, mimeType: mime, blob: file.data },
              },
            ],
          };
    },
  },
];

function mcpMessage(user, msg) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "invalid request");
  if (msg.id === undefined) return null; // notification : pas de réponse
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "nautila", version: "0.1.0" },
        instructions:
          "Notes de cours, flashcards, quiz et devoirs de l'utilisateur dans Nautila. Lis les pages avant de créer des cartes ou des quiz à partir de leur contenu.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, "unknown tool");
      try {
        const args = msg.params.arguments;
        const result = tool.run(user, args && typeof args === "object" ? args : {});
        return reply(result?.content ? result : { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        if (!(err instanceof HttpError)) console.error(err);
        return reply({
          content: [{ type: "text", text: err instanceof HttpError ? err.message : "Erreur interne" }],
          isError: true,
        });
      }
    }
    default:
      return fail(-32601, "method not found");
  }
}

/** Lit un corps JSON, en refusant tout ce qui dépasse `limit` octets avant de l'avoir lu en entier. */
async function readJson(req, limit = MAX_BODY, allowArray = false) {
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "body too large");
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= limit) return void chunks.push(chunk);
      chunks.length = 0;
      reject(new HttpError(413, "body too large"));
      discard(req);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  try {
    const body = JSON.parse(raw.toString("utf8") || "{}");
    if (!body || typeof body !== "object" || (Array.isArray(body) && !allowArray)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

/**
 * Lit et jette la suite d'un corps refusé, pour que le client reçoive la réponse d'erreur au lieu
 * d'une connexion coupée en plein envoi ; au-delà de 64 Mo, la connexion est fermée.
 */
function discard(req) {
  if (req.discarding || req.complete || req.destroyed) return;
  req.discarding = true;
  let extra = 0;
  req.removeAllListeners("data");
  req.on("data", (chunk) => {
    if ((extra += chunk.length) > 64 * MB) req.destroy();
  });
  req.resume();
}

const bearer = (req) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];

/**
 * Compte associé à un jeton. Un jeton MCP n'est accepté que là où `kinds` le permet ;
 * un jeton resté inutilisé plus de TOKEN_TTL est supprimé.
 */
function authenticate(token, kinds = ["session"]) {
  const hash = token && token.length <= 200 ? sha(token) : null;
  const row = hash && q.byToken.get(hash);
  if (!row || !kinds.includes(row.token_kind)) throw new HttpError(401, "unauthorized");
  const now = Date.now();
  if (TOKEN_TTL > 0 && now - (row.token_used ?? 0) > TOKEN_TTL) {
    q.dropToken.run(hash);
    throw new HttpError(401, "unauthorized");
  }
  // Date de dernière utilisation : notée au plus une fois par heure, pour limiter les écritures.
  if (now - (row.token_used ?? 0) > 60 * MINUTE) q.touchToken.run(now, hash);
  return { user: { id: row.id, username: row.username }, hash };
}

/** Adresse du client ; X-Forwarded-For n'est cru que si TRUST_PROXY indique un relais de confiance. */
function clientIp(req) {
  if (PROXY_HOPS > 0) {
    const chain = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Chaque relais ajoute à droite l'adresse de celui qui lui parle : on compte depuis la droite.
    if (chain.length > 0) return chain[Math.max(0, chain.length - PROXY_HOPS)];
  }
  return req.socket.remoteAddress ?? "unknown";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

/** En-têtes de toutes les réponses. */
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};
/**
 * Politique de l'application web : scripts de l'origine seulement, WASM (SQLite, PDF),
 * styles en ligne (éditeur), images et médias de n'importe quel site (images insérées par
 * adresse), et connexions à n'importe quel serveur de synchronisation choisi par l'utilisateur.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https: http: data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const HTML_HEADERS = {
  "Content-Security-Policy": APP_CSP,
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
};
const API_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

/** Types qu'un fichier joint peut garder quand il est affiché : images matricielles, audio, vidéo, PDF. */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
]);
function inlineType(mime) {
  const type = String(mime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return INLINE_TYPES.has(type) || /^(audio|video)\/[a-z0-9.+-]+$/.test(type) ? type : null;
}

/**
 * Sert un fichier joint, dont le type a été choisi par le client qui l'a envoyé : seuls les
 * types sans danger sont affichés ; le reste (HTML, SVG, XML…) est proposé au téléchargement.
 * La réponse est isolée (sandbox) même si un navigateur l'ouvrait comme une page.
 */
function sendFile(res, record, headers) {
  const file = JSON.parse(record.data);
  const body = Buffer.from(String(file.data ?? ""), "base64");
  const type = inlineType(file.mime);
  const name = String(file.name ?? "").slice(0, 200) || "fichier";
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  let encoded;
  try {
    encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    encoded = encodeURIComponent(ascii); // nom mal formé (moitié de caractère Unicode)
  }
  res.writeHead(200, {
    ...SECURITY,
    ...headers,
    "Content-Type": type ?? "application/octet-stream",
    "Content-Disposition": `${type ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Length": body.length,
    "Cache-Control": "private, max-age=3600",
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "bad request");
  }
  if (path.includes("\0")) throw new HttpError(400, "bad request");
  let file = normalize(join(STATIC_DIR, path));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) throw new HttpError(403, "forbidden");
  const found = await stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
  if (!found) {
    // Fichier versionné disparu (ancienne version de l'application) : surtout pas la page
    // d'entrée à sa place, qu'un navigateur ou le service worker prendrait pour un script.
    if (path.startsWith("/assets/")) throw new HttpError(404, "not found");
    // Toute autre adresse inconnue renvoie l'application (elle gère ses propres routes).
    file = join(STATIC_DIR, "index.html");
  }
  const body = await readFile(file).catch(() => null);
  if (!body) throw new HttpError(404, "not found");
  const type = MIME[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, {
    ...SECURITY,
    ...(type.startsWith("text/html") ? HTML_HEADERS : {}),
    "Content-Type": type,
    "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}

/** En-têtes CORS d'une réponse d'API, selon l'origine de la requête. */
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!CORS_ORIGINS) return { "Access-Control-Allow-Origin": "*" };
  return origin && CORS_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : { Vary: "Origin" };
}
const PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

async function handle(req, res) {
  let path;
  try {
    path = new URL(req.url, "http://x").pathname;
  } catch {
    path = "/";
  }
  const isMcp = path === "/mcp" || path.startsWith("/mcp/");
  const isApi = path.startsWith("/api/");
  // Les pages publiques ne sont lues que par l'application servie ici : pas besoin de CORS.
  const cors = (isApi && !path.startsWith("/api/public/")) || isMcp ? corsHeaders(req) : {};
  const send = (status, body) => {
    res.writeHead(status, { ...SECURITY, ...API_HEADERS, "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify(body));
  };
  const ip = clientIp(req);

  if ((isApi || isMcp) && req.method === "OPTIONS")
    return void res.writeHead(204, { ...SECURITY, ...cors, ...PREFLIGHT }).end();

  if (isMcp) {
    if (req.method !== "POST") throw new HttpError(405, "method not allowed");
    // Le jeton vient de l'en-tête Authorization, ou de l'adresse (/mcp/<jeton>) pour les clients
    // sans en-tête (claude.ai). Cette adresse n'est jamais journalisée par ce serveur.
    const token = bearer(req) ?? (path.length > 5 ? path.slice(5) : undefined);
    // Les jetons de session restent acceptés : les connecteurs créés avant les jetons MCP en utilisent un.
    const { user } = authenticate(token, ["mcp", "session"]);
    if (!mcpHits.take(user.id)) throw new HttpError(429, "too many requests");
    const body = await readJson(req, MCP_BODY, true);
    const out = Array.isArray(body)
      ? body
          .slice(0, 50)
          .map((m) => mcpMessage(user, m))
          .filter(Boolean)
      : mcpMessage(user, body);
    if (out === null || (Array.isArray(out) && out.length === 0))
      return void res.writeHead(202, { ...SECURITY, ...cors }).end();
    return send(200, out);
  }
  if (!isApi) {
    if (STATIC_DIR && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(res, path);
    throw new HttpError(404, "not found");
  }
  if (path === "/api/health") return send(200, { ok: true, registration: REGISTRATION });

  // Page publique : lecture seule, sans compte. Seuls le contenu et les fichiers qu'il utilise sont servis.
  const pub = /^\/api\/public\/([\w-]+)(?:\/file\/([\w-]+))?$/.exec(path);
  if (pub && req.method === "GET") {
    if (!publicHits.take(ip)) throw new HttpError(429, "too many requests");
    const row = q.share.get(pub[1]);
    if (!row?.public) throw new HttpError(404, "not found");
    if (!pub[2]) {
      const room = rooms.get(row.id);
      const ydoc = room ? Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64") : row.ydoc;
      return send(200, { title: row.title, ydoc });
    }
    if (!citesFile(row, pub[2])) throw new HttpError(404, "not found");
    const record = q.sharedFile.get(pub[2], row.owner_id, row.id);
    if (!record) throw new HttpError(404, "not found");
    return sendFile(res, record, {});
  }
  // Fichier d'une page partagée, pour ses participants (il est dans le compte de celui qui l'a ajouté).
  const sharedFile = /^\/api\/share\/([\w-]+)\/file\/([\w-]+)$/.exec(path);
  if (sharedFile && req.method === "GET") {
    const { user } = authenticate(bearer(req));
    const { share: row } = shareAccess(sharedFile[1], user);
    if (!citesFile(row, sharedFile[2])) throw new HttpError(404, "not found");
    const record = q.sharedFile.get(sharedFile[2], row.owner_id, row.id);
    if (!record) throw new HttpError(404, "not found");
    return sendFile(res, record, cors);
  }
  const stream = /^\/api\/share\/([\w-]+)\/stream$/.exec(path);
  if (stream && req.method === "GET") {
    const { user } = authenticate(bearer(req));
    const { share, role } = shareAccess(stream[1], user, { join: true });
    return shareStream(openRoom(share), req, res, user, role, { ...SECURITY, ...cors });
  }
  if (req.method !== "POST") throw new HttpError(405, "method not allowed");

  if (path === "/api/register" || path === "/api/login") {
    const body = await readJson(req, AUTH_BODY);
    return send(200, path === "/api/register" ? await register(body, ip) : await login(body, ip));
  }
  const auth = authenticate(bearer(req));
  const { user } = auth;
  switch (path) {
    case "/api/logout":
      q.dropToken.run(auth.hash);
      return send(200, { ok: true });
    case "/api/logout-others":
      return send(200, { ok: true, revoked: Number(q.dropOtherSessions.run(user.id, auth.hash).changes) });
    case "/api/password":
      return send(200, await changePassword(auth, await readJson(req, AUTH_BODY), ip));
    case "/api/sync":
      return send(200, sync(user, await readJson(req)));
    case "/api/token": {
      // Jeton du connecteur MCP : distinct des sessions, refusé ailleurs que sur /mcp.
      const token = issueToken(user.id, "mcp");
      q.trimMcpTokens.run(user.id, user.id);
      return send(200, { token });
    }
    case "/api/tokens":
      return send(200, { tokens: q.mcpTokens.all(user.id) });
    case "/api/token/revoke": {
      const { id } = await readJson(req, SMALL_BODY);
      if (typeof id !== "string" || !/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, "invalid token");
      return send(200, { ok: true, revoked: Number(q.dropMcpToken.run(user.id, id).changes) });
    }
    case "/api/share":
      return send(200, createShare(user, await readJson(req, SHARE_BODY)));
    case "/api/shares/state":
      return send(200, sharesState(user, await readJson(req, 2 * MB)));
  }
  const share = /^\/api\/share\/([\w-]+)(?:\/(update|awareness|delete|public|access|member))?$/.exec(path);
  if (!share) throw new HttpError(404, "not found");
  const [, id, action] = share;
  if (action === "delete") {
    ownedShare(id, user);
    const room = rooms.get(id);
    if (room) {
      broadcast(room, null, { type: "closed" });
      for (const client of room.clients.values()) client.res.end();
      clearTimeout(room.timer);
      rooms.delete(id);
    }
    docTexts.delete(id);
    q.dropShare.run(id);
    q.dropMembers.run(id);
    return send(200, { ok: true });
  }
  if (action === "access" || action === "member") {
    ownedShare(id, user);
    const body = await readJson(req, SMALL_BODY);
    if (action === "access") {
      if (body.access !== "edit" && body.access !== "view") throw new HttpError(400, "invalid access");
      q.setAccess.run(body.access, id);
    } else {
      // role : "edit", "view", "none" (retiré) ou null (suit le réglage général).
      if (![null, "edit", "view", "none"].includes(body.role)) throw new HttpError(400, "invalid role");
      q.setMember.run(body.role, id, Number(body.user) || 0);
    }
    refreshRoles(id);
    return send(200, { access: q.share.get(id).access, members: q.members.all(id) });
  }
  if (action === "public") {
    ownedShare(id, user);
    const enabled = (await readJson(req, SMALL_BODY)).public === true;
    q.setPublic.run(enabled ? 1 : 0, id);
    return send(200, { public: enabled });
  }
  // Lire ou modifier : le droit du compte est vérifié à chaque requête.
  const { share: row, role } = shareAccess(id, user, { write: action === "update", join: !action });
  if (action === "update") return send(200, shareUpdate(openRoom(row), await readJson(req, SHARE_BODY)));
  if (action === "awareness") {
    const body = await readJson(req, SMALL_BODY);
    // Personne n'est connecté à une salle fermée : rien à relayer.
    const room = rooms.get(id);
    if (room && typeof body.update === "string") broadcast(room, body.conn, { type: "awareness", update: body.update });
    return send(200, { ok: true });
  }
  await readJson(req, SMALL_BODY);
  return send(200, {
    title: row.title,
    owner: role === "owner",
    role,
    access: row.access,
    public: !!row.public,
    members: role === "owner" ? q.members.all(id) : undefined,
    ydoc: Buffer.from(Y.encodeStateAsUpdate(shareDoc(row))).toString("base64"),
  });
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    // Aucun détail interne dans la réponse ; l'adresse demandée (qui peut contenir un jeton) n'est pas journalisée.
    if (!(err instanceof HttpError)) console.error(err);
    if (res.headersSent) return void res.end();
    // Corps pas encore lu (refus avant lecture) : jeté, sauf s'il est annoncé démesuré.
    if (!(Number(req.headers["content-length"]) > MAX_BODY + 64 * MB)) discard(req);
    const isApi = /^\/(api|mcp)(\/|$)/.test(req.url ?? "");
    const cors = isApi && !(req.url ?? "").startsWith("/api/public/") ? corsHeaders(req) : {};
    res.writeHead(err instanceof HttpError ? err.status : 500, {
      ...SECURITY,
      ...API_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
    });
    res.end(JSON.stringify({ error: err instanceof HttpError ? err.message : "server error" }));
  }
});

// Ménage régulier : salles ouvertes par une simple requête, compteurs, jetons expirés, vieilles suppressions.
let lastPurge = 0;
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) if (room.clients.size === 0 && now - room.used > MINUTE) closeRoom(room);
  for (const counter of COUNTERS) counter.purge(now);
  if (now - lastPurge < 60 * MINUTE) return;
  lastPurge = now;
  if (TOKEN_TTL > 0) q.expireTokens.run(now - TOKEN_TTL);
  if (TOMBSTONE_TTL > 0) q.purgeTombstones.run(now - TOMBSTONE_TTL);
}, 30_000).unref();

// À l'arrêt, les pages partagées ouvertes sont enregistrées avant de quitter.
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    for (const room of rooms.values()) persistRoom(room);
    process.exit(0);
  });

server.listen(PORT, () =>
  console.log(
    `Nautila : serveur à l'écoute sur le port ${server.address().port} (inscriptions : ${REGISTRATION}` +
      `${PROXY_HOPS ? `, relais de confiance : ${PROXY_HOPS}` : ""})`,
  ),
);
