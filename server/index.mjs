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
  "review_log", "study_log",
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
  // Secret du lien d'invitation, distinct de l'identifiant ; vide : l'identifiant seul suffit (anciens liens).
  ["shares", "invite", "TEXT"],
  // 1 : page partagée avant la table share_files ; les fichiers des participants y sont relevés à leur prochaine modification.
  ["shares", "legacy_files", "INTEGER NOT NULL DEFAULT 0"],
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
  -- Octets occupés par compte, tenus à jour à chaque écriture ; une ligne absente est recalculée à la demande.
  CREATE TABLE IF NOT EXISTS user_usage (user_id INTEGER PRIMARY KEY, bytes INTEGER NOT NULL);
  -- Fichiers qu'un compte a mis dans une page partagée : seuls ceux-là sont servis aux autres.
  CREATE TABLE IF NOT EXISTS share_files (
    share_id TEXT NOT NULL, file_id TEXT NOT NULL, user_id INTEGER NOT NULL,
    PRIMARY KEY (share_id, file_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

/** Identifiants de fichiers cités (`nautila-file:<id>`) dans un état ou une mise à jour Yjs, au plus `max`. */
function citedFiles(bytes, max = 200) {
  const ids = new Set();
  for (const m of Buffer.from(bytes)
    .toString("latin1")
    .matchAll(/nautila-file:([\w-]{16,64})/g)) {
    ids.add(m[1]);
    if (ids.size >= max) break;
  }
  return ids;
}

// Pages partagées existantes : seuls les fichiers du propriétaire cités par le document restent servis.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'share_files'").get()) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const add = db.prepare("INSERT OR IGNORE INTO share_files (share_id, file_id, user_id) VALUES (?, ?, ?)");
    for (const share of db.prepare("SELECT id, owner_id, ydoc FROM shares").iterate())
      for (const file of citedFiles(Buffer.from(share.ydoc ?? "", "base64"), Infinity))
        add.run(share.id, file, share.owner_id);
    db.exec("UPDATE shares SET legacy_files = 1");
    db.exec("INSERT INTO meta (key, value) VALUES ('share_files', '1')");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

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
  setMember: db.prepare(
    "UPDATE share_members SET role = ? WHERE share_id = ? AND user_id = ? AND (role IS NULL OR role != 'left')",
  ),
  rejoin: db.prepare("UPDATE share_members SET role = NULL WHERE share_id = ? AND user_id = ? AND role = 'left'"),
  members: db.prepare(
    `SELECT m.user_id AS id, u.username, m.role FROM share_members m JOIN users u ON u.id = m.user_id
     WHERE m.share_id = ? AND (m.role IS NULL OR m.role != 'left') ORDER BY m.joined_at`,
  ),
  dropMembers: db.prepare("DELETE FROM share_members WHERE share_id = ?"),
  // "left" : le participant a quitté la page lui-même ; il peut la rejoindre de nouveau par le lien.
  leave: db.prepare(
    `INSERT INTO share_members (share_id, user_id, role, joined_at) VALUES (?, ?, 'left', ?)
     ON CONFLICT (share_id, user_id) DO UPDATE SET role = 'left'`,
  ),
  setInvite: db.prepare("UPDATE shares SET invite = ? WHERE id = ?"),
  ownerName: db.prepare("SELECT username FROM users WHERE id = ?"),
  fileOf: db.prepare("SELECT data FROM records WHERE user_id = ? AND tbl = 'files' AND id = ? AND data IS NOT NULL"),
  hasFile: db.prepare("SELECT 1 FROM records WHERE user_id = ? AND tbl = 'files' AND id = ? AND data IS NOT NULL"),
  addShareFile: db.prepare("INSERT OR IGNORE INTO share_files (share_id, file_id, user_id) VALUES (?, ?, ?)"),
  dropShareFiles: db.prepare("DELETE FROM share_files WHERE share_id = ?"),
  dropMemberFiles: db.prepare("DELETE FROM share_files WHERE share_id = ? AND user_id = ?"),
  // Fichier d'une page partagée : seulement si le compte à qui il appartient l'a mis dans cette page,
  // et qu'il en est encore le propriétaire ou un participant.
  sharedFile: db.prepare(
    `SELECT r.data FROM share_files f
       JOIN records r ON r.user_id = f.user_id AND r.tbl = 'files' AND r.id = f.file_id AND r.data IS NOT NULL
     WHERE f.share_id = ?1 AND f.file_id = ?2 AND (f.user_id = ?3 OR f.user_id IN
       (SELECT user_id FROM share_members WHERE share_id = ?1 AND (role IS NULL OR role NOT IN ('none', 'left'))))
     ORDER BY f.user_id = ?3 DESC LIMIT 1`,
  ),
  // Ce qui compte dans l'espace d'un compte : ses lignes et les documents des pages qu'il partage (en octets).
  usage: db.prepare(
    `SELECT (SELECT COALESCE(SUM(LENGTH(CAST(data AS BLOB))), 0) FROM records WHERE user_id = ?1)
          + (SELECT COALESCE(SUM(LENGTH(ydoc)), 0) FROM shares WHERE owner_id = ?1) AS bytes`,
  ),
  usageRow: db.prepare("SELECT bytes FROM user_usage WHERE user_id = ?"),
  setUsage: db.prepare("INSERT OR REPLACE INTO user_usage (user_id, bytes) VALUES (?, ?)"),
  addUsage: db.prepare("UPDATE user_usage SET bytes = MAX(0, bytes + ?) WHERE user_id = ?"),
  tokenAlive: db.prepare("SELECT last_used FROM tokens WHERE hash = ?"),
  otherMcp: db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE user_id = ? AND hash != ? AND kind = 'mcp'"),
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

/**
 * Octets occupés par un compte. Le compteur est tenu à jour à chaque écriture ; il n'est calculé
 * en entier qu'une fois par compte (premier appel après la mise à jour du serveur).
 */
function usageOf(userId) {
  const row = q.usageRow.get(userId);
  if (row) return row.bytes;
  const { bytes } = q.usage.get(userId);
  q.setUsage.run(userId, bytes);
  return bytes;
}
/** Ajoute (ou retire) des octets au compteur ; sans compteur, rien à faire : le calcul complet les comptera. */
const addUsage = (userId, delta) => void (delta && q.addUsage.run(delta, userId));
const byteLength = (s) => (s == null ? 0 : Buffer.byteLength(s));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const hashPassword = (password, salt) => limitedScrypt(password, salt);
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
  /** Annule un passage compté d'avance (essai finalement réussi). */
  undo(key, now = Date.now()) {
    const entry = this.entry(key, now);
    if (entry && entry.count > 0) entry.count--;
  }
  clear(key) {
    this.map.delete(key);
  }
  purge(now = Date.now()) {
    for (const [key, entry] of this.map) if (now - entry.start >= this.window) this.map.delete(key);
  }
}

// Essais de mot de passe, par adresse et par identifiant : chaque essai est compté AVANT le calcul
// (des essais simultanés ne passent pas entre le contrôle et le comptage), puis rendu s'il réussit.
const ipFailures = new Counter(15 * MINUTE, num(env.LOGIN_MAX_PER_IP, 30));
const userFailures = new Counter(15 * MINUTE, num(env.LOGIN_MAX_PER_USER, 10));
const publicHits = new Counter(MINUTE, num(env.PUBLIC_MAX_PER_MINUTE, 600));
const mcpHits = new Counter(MINUTE, num(env.MCP_MAX_PER_MINUTE, 240));
/** Messages de présence (curseurs) par connexion à une page partagée. */
const awarenessHits = new Counter(10_000, 40);
const COUNTERS = [ipFailures, userFailures, publicHits, mcpHits, awarenessHits];

function guard(ip, username) {
  if (ipFailures.over(ip) || (username && userFailures.over(username))) throw new HttpError(429, "too many attempts");
}
function failed(ip, username) {
  ipFailures.hit(ip);
  if (username) userFailures.hit(username);
}

/**
 * Clé d'adresse pour les compteurs : une adresse IPv4 telle quelle, une adresse IPv6 réduite à son
 * préfixe /64 (un abonné en reçoit généralement un entier, il ne doit pas multiplier ses essais).
 */
function ipKey(ip) {
  const s = String(ip ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) return v4[1];
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return s;
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return s;
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups =
    tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(":")}::/64`;
}

/** Calculs scrypt en cours par compte, et file d'attente globale (le calcul occupe un fil du pool de libuv). */
const SCRYPT_MAX = Math.max(1, num(env.SCRYPT_CONCURRENCY, 4));
const SCRYPT_QUEUE = 64;
const SCRYPT_PER_USER = 2;
let scryptRunning = 0;
const scryptWaiting = [];
const scryptByUser = new Map();

async function limitedScrypt(password, salt) {
  if (scryptRunning >= SCRYPT_MAX) {
    if (scryptWaiting.length >= SCRYPT_QUEUE) throw new HttpError(503, "server busy");
    await new Promise((resolve) => scryptWaiting.push(resolve));
  } else scryptRunning++;
  try {
    return await scrypt(password, salt, 64);
  } finally {
    // La place passe directement au suivant de la file, sinon elle est libérée.
    const next = scryptWaiting.shift();
    if (next) next();
    else scryptRunning--;
  }
}

/** Réserve un calcul de mot de passe pour un compte ; refuse au-delà de SCRYPT_PER_USER simultanés. */
async function perUser(username, run) {
  const running = scryptByUser.get(username) ?? 0;
  if (running >= SCRYPT_PER_USER) throw new HttpError(429, "too many attempts");
  scryptByUser.set(username, running + 1);
  try {
    return await run();
  } finally {
    const left = (scryptByUser.get(username) ?? 1) - 1;
    if (left > 0) scryptByUser.set(username, left);
    else scryptByUser.delete(username);
  }
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
  // Compté avant le calcul, dans le même tour synchrone que le contrôle.
  failed(ip, username);
  const user = q.user.get(username);
  if (!(await perUser(username, () => checkPassword(user, password)))) throw new HttpError(401, "bad credentials");
  userFailures.clear(username);
  ipFailures.undo(ip);
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
  failed(ip, user.username);
  // Pas 401 : l'appareil reste connecté, seul l'ancien mot de passe est faux.
  if (!(await perUser(user.username, () => checkPassword(q.userById.get(user.id), current))))
    throw new HttpError(403, "bad credentials");
  userFailures.undo(user.username);
  ipFailures.undo(ip);
  const salt = randomBytes(16).toString("hex");
  q.setPassword.run(salt, (await hashPassword(password, salt)).toString("hex"), user.id);
  const { changes } = q.dropOtherTokens.run(user.id, auth.hash);
  closeRevokedStreams();
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
  // Une seule fois chaque ligne (la dernière envoyée) : sinon un lot répétant mille fois une grosse
  // page ferait relire et refusionner son document mille fois, serveur bloqué pendant ce temps.
  const latest = new Map();
  for (const c of Array.isArray(body.changes) ? body.changes : []) latest.set(`${c?.tbl}\u0000${c?.id}`, c);
  const changes = [...latest.values()];
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
      added += byteLength(json) - byteLength(existing?.data);
      const seq = next();
      q.put.run(user.id, c.tbl, c.id, json, stamp, seq);
      if (json === (c.data === null ? null : JSON.stringify(c.data))) echoed.add(seq);
    }
    // Compteur mis à jour dans la transaction : annulé avec elle si le quota est dépassé.
    addUsage(user.id, added);
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
  // `tables` : ce que ce serveur accepte, pour qu'un appareil plus récent garde le reste pour lui.
  return { seq: cursor, changes: out, more, tables: [...TABLES] };
}

// ---------- Pages partagées en direct ----------
// Une page partagée est un document Yjs tenu en mémoire tant que quelqu'un
// l'a ouverte. Toute personne connectée qui possède son lien (identifiant de
// 128 bits aléatoires, plus le secret d'invitation s'il a été régénéré) peut la
// rejoindre ; le propriétaire décide qui peut modifier.
const rooms = new Map();
/** Flux ouverts par compte, pour qu'un seul compte ne puisse pas épuiser les connexions. */
const streams = new Map();
const MAX_STREAMS = 40;
/** Au-delà de ce volume en attente d'envoi, un flux qui ne lit plus est fermé. */
const STREAM_BUFFER = 1 * MB;
/** Mémoire des salles qu'un même compte peut faire ouvrir (documents chargés à sa demande). */
const MAX_OPEN_BYTES = num(env.MAX_OPEN_SHARES_MB, 256) * MB;
/** Salles ouvertes à la demande de chaque compte. */
const openedBy = new Map();
/** Taille maximale d'un message de présence (curseur), en base64. */
const AWARENESS_MAX = 4096;
/** Pages traitées par /api/shares/state, et volume de documents lus par requête. */
const STATE_ENTRIES = 300;
const STATE_BYTES = 64 * MB;
let roomSerial = 0;

/** Format des identifiants de partage et des secrets d'invitation (16 octets aléatoires en base64url). */
const SHARE_ID = /^[\w-]{16,64}$/;
const invited = (share, invite) => !share.invite || (typeof invite === "string" && safeEqual(invite, share.invite));

/**
 * Droit d'un compte sur une page partagée : "owner", "edit", "view" ou "none" (retiré, parti, ou
 * sans le secret d'invitation). Le réglage propre au participant l'emporte sur le réglage général.
 * `join: "link"` : le compte rejoint par le lien (secret vérifié), même s'il était parti ;
 * `join: "open"` : l'ouverture du flux inscrit un compte jamais vu, si la page n'a pas de secret
 * (participants arrivés avant la liste des participants).
 */
function roleOf(share, user, { join, invite } = {}) {
  if (share.owner_id === user.id) return "owner";
  let member = q.member.get(share.id, user.id);
  if (join === "link" && (!member || member.role === "left") && invited(share, invite)) {
    if (member) q.rejoin.run(share.id, user.id);
    else q.addMember.run(share.id, user.id, Date.now());
    member = { role: null };
  } else if (join === "open" && !member && !share.invite) {
    q.addMember.run(share.id, user.id, Date.now());
    member = { role: null };
  }
  // Page sans secret : comme avant, l'identifiant suffit.
  if (!member) return share.invite ? "none" : share.access;
  if (member.role === "left") return "none";
  return member.role ?? share.access;
}

/** Vérifie le droit d'un compte ; refuse s'il a été retiré, ou s'il ne peut que lire quand `write` est demandé. */
function shareAccess(id, user, { write = false, join, invite } = {}) {
  const share = q.share.get(id);
  if (!share) throw new HttpError(404, "share not found");
  const role = roleOf(share, user, { join, invite });
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

/** Vrai si le jeton existe encore et n'a pas expiré ; un flux ouvert compte comme une utilisation. */
function tokenAlive(hash, now = Date.now()) {
  const row = q.tokenAlive.get(hash);
  if (!row || (TOKEN_TTL > 0 && now - (row.last_used ?? 0) > TOKEN_TTL)) return false;
  if (now - (row.last_used ?? 0) > 60 * MINUTE) q.touchToken.run(now, hash);
  return true;
}

/** Envoie une trame à un flux ; ferme celui qui ne lit plus (trop de données en attente). */
function push(client, frame) {
  if (client.closed) return;
  client.res.write(frame);
  // Coupé net : avec une simple fin de réponse, les données en attente resteraient en mémoire.
  if (client.res.writableLength > STREAM_BUFFER) client.close(true);
}

/** Ferme les flux dont le jeton n'existe plus (déconnexion, mot de passe changé, jeton révoqué ou expiré). */
function closeRevokedStreams() {
  const now = Date.now();
  for (const room of [...rooms.values()])
    for (const client of [...room.clients.values()]) if (!tokenAlive(client.hash, now)) client.close();
}

/** Annonce à chaque participant connecté son droit actuel, et coupe ceux qui ont été retirés. */
function refreshRoles(id) {
  const room = rooms.get(id);
  const share = q.share.get(id);
  if (!room || !share) return;
  for (const client of [...room.clients.values()]) {
    client.role = roleOf(share, client.user);
    push(client, `data: ${JSON.stringify({ type: "role", role: client.role })}\n\n`);
    if (client.role === "none") client.close();
  }
}

function openRoom(share, user) {
  let room = rooms.get(share.id);
  if (!room) {
    const mine = openedBy.get(user.id) ?? new Set();
    let bytes = share.ydoc?.length ?? 0;
    for (const id of mine) bytes += rooms.get(id)?.bytes ?? 0;
    if (bytes > MAX_OPEN_BYTES) throw new HttpError(429, "too many open shares");
    const doc = new Y.Doc();
    if (share.ydoc) Y.applyUpdate(doc, b64(share.ydoc));
    room = {
      id: share.id,
      /** Numéro de la salle et de sa version : clé des caches dérivés du document. */
      serial: ++roomSerial,
      version: 0,
      owner: share.owner_id,
      opener: user.id,
      doc,
      clients: new Map(),
      /** Présences annoncées : identifiant Yjs du client → connexion qui l'a annoncé, et son horloge. */
      awareness: new Map(),
      dirty: false,
      deleted: false,
      timer: null,
      /** Taille approchée du document en mémoire, et taille de la version enregistrée (base64). */
      bytes: share.ydoc?.length ?? 0,
      stored: share.ydoc?.length ?? 0,
      /** Page partagée avant share_files : comptes dont les fichiers déjà cités ont été relevés. */
      legacyFiles: !!share.legacy_files,
      scanned: new Set(),
      used: 0,
    };
    rooms.set(share.id, room);
    mine.add(share.id);
    openedBy.set(user.id, mine);
  }
  room.used = Date.now();
  return room;
}

function persistRoom(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (!room.dirty || room.deleted) return;
  room.dirty = false;
  const ydoc = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64");
  addUsage(room.owner, ydoc.length - room.stored);
  room.bytes = room.stored = ydoc.length;
  q.saveShare.run(ydoc, Date.now(), room.id);
}

function closeRoom(room) {
  persistRoom(room);
  if (rooms.get(room.id) === room) rooms.delete(room.id);
  const mine = openedBy.get(room.opener);
  mine?.delete(room.id);
  if (mine?.size === 0) openedBy.delete(room.opener);
}

function broadcast(room, except, event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const [conn, client] of [...room.clients]) if (conn !== except) push(client, frame);
}

/** Note les fichiers que ce compte cite dans ce qu'il vient d'écrire : il accepte de les montrer aux participants. */
function registerFiles(shareId, userId, bytes) {
  for (const file of citedFiles(bytes)) q.addShareFile.run(shareId, file, userId);
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
  addUsage(user.id, ydoc?.length ?? 0);
  if (ydoc) registerFiles(id, user.id, b64(ydoc));
  return { id };
}

function deleteShare(share) {
  const room = rooms.get(share.id);
  if (room) {
    room.deleted = true;
    broadcast(room, null, { type: "closed" });
    for (const client of [...room.clients.values()]) client.close();
    closeRoom(room);
  }
  docCache.delete(share.id);
  addUsage(share.owner_id, -(share.ydoc?.length ?? 0));
  q.dropShare.run(share.id);
  q.dropMembers.run(share.id);
  q.dropShareFiles.run(share.id);
}

function shareStream(room, req, res, auth, role, headers) {
  const { user, hash } = auth;
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
  let beat;
  const cleanup = () => {
    if (client.closed) return;
    client.closed = true;
    clearInterval(beat);
    const left = (streams.get(user.id) ?? 1) - 1;
    if (left > 0) streams.set(user.id, left);
    else streams.delete(user.id);
    room.clients.delete(conn);
    releaseAwareness(room, conn);
    room.used = Date.now();
    broadcast(room, null, { type: "peers", peers: room.clients.size });
    if (room.clients.size === 0) closeRoom(room);
  };
  const client = {
    res,
    user,
    /** Empreinte du jeton qui a ouvert le flux : il est fermé dès que ce jeton disparaît. */
    hash,
    role,
    closed: false,
    close(hard = false) {
      cleanup();
      if (hard) res.destroy();
      else res.end();
    },
  };
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64");
  room.clients.set(conn, client);
  push(client, `data: ${JSON.stringify({ type: "sync", conn, update: state, peers: room.clients.size, role })}\n\n`);
  broadcast(room, conn, { type: "peers", peers: room.clients.size });
  // Battement : garde la connexion ouverte et revérifie le jeton (révoqué ou expiré entre-temps).
  beat = setInterval(() => (tokenAlive(hash) ? push(client, ": ping\n\n") : client.close()), 25_000);
  req.on("close", cleanup);
  res.on("close", cleanup);
}

/** Document d'une page partagée : celui de la salle ouverte, sinon la dernière version enregistrée. */
function shareDoc(share) {
  const room = rooms.get(share.id);
  if (room) return room.doc;
  const doc = new Y.Doc();
  if (share.ydoc) Y.applyUpdate(doc, b64(share.ydoc));
  return doc;
}

/**
 * Données dérivées du document d'une page partagée (texte, état encodé), gardées en cache
 * tant que le document ne change pas : par version de la salle ouverte, sinon par date d'enregistrement.
 */
const docCache = new Map();
function cachedDoc(share, field, compute) {
  const room = rooms.get(share.id);
  const key = room ? `r${room.serial}.${room.version}` : `d${share.updated_at}`;
  let entry = docCache.get(share.id);
  if (entry?.key !== key) {
    if (docCache.size > 200) docCache.clear();
    entry = { key };
    docCache.set(share.id, entry);
  }
  return (entry[field] ??= compute());
}
const shareText = (share) => cachedDoc(share, "text", () => shareDoc(share).getXmlFragment("doc").toString());
/** État complet du document, en base64 (page publique). */
const shareState = (share) =>
  rooms.has(share.id)
    ? cachedDoc(share, "state", () => Buffer.from(Y.encodeStateAsUpdate(rooms.get(share.id).doc)).toString("base64"))
    : share.ydoc;

/** Vrai si le document de la page cite ce fichier (identifiant entier, pas un simple fragment). */
const citesFile = (share, fileId) =>
  fileId.length >= 16 && new RegExp(`(?<![\\w-])${fileId}(?![\\w-])`).test(shareText(share));

/**
 * État des pages partagées d'un appareil, pour les mettre à jour sans les ouvrir :
 * pour chacune, ce qui manque à l'appareil (d'après son vecteur d'état) et le vecteur
 * d'état du serveur, qui lui permet d'envoyer en retour ce que le serveur n'a pas.
 * Chaque page n'est traitée qu'une fois ; au-delà de STATE_BYTES lus, les suivantes sont omises
 * (l'appareil, qui les envoie dans un ordre aléatoire, les reprendra à une prochaine synchronisation).
 */
function sharesState(user, body) {
  const wanted = new Map();
  for (const entry of Array.isArray(body.shares) ? body.shares : []) {
    const id = entry?.id;
    if (typeof id !== "string" || !SHARE_ID.test(id) || wanted.has(id)) continue;
    wanted.set(id, entry.sv);
    if (wanted.size >= STATE_ENTRIES) break;
  }
  let budget = STATE_BYTES;
  const shares = [];
  for (const [id, sv] of wanted) {
    const share = q.share.get(id);
    if (!share) {
      shares.push({ id, role: "gone" });
      continue;
    }
    const role = roleOf(share, user);
    if (role === "none") {
      shares.push({ id, role });
      continue;
    }
    const room = rooms.get(id);
    const size = room ? room.bytes : (share.ydoc?.length ?? 0);
    if (size > budget && shares.length > 0) continue;
    budget -= size;
    let vector;
    try {
      vector = typeof sv === "string" && sv ? b64(sv) : undefined;
      if (vector) Y.decodeStateVector(vector);
    } catch {
      vector = undefined;
    }
    try {
      // Document fermé : calculé sur la version enregistrée, sans le reconstruire en mémoire.
      const stored = room ? null : share.ydoc ? b64(share.ydoc) : Y.encodeStateAsUpdate(new Y.Doc());
      const update = room ? Y.encodeStateAsUpdate(room.doc, vector) : vector ? Y.diffUpdate(stored, vector) : stored;
      const state = room ? Y.encodeStateVector(room.doc) : Y.encodeStateVectorFromUpdate(stored);
      shares.push({
        id,
        role,
        update: Buffer.from(update).toString("base64"),
        sv: Buffer.from(state).toString("base64"),
      });
    } catch {
      shares.push({ id, role }); // version enregistrée illisible : rien à transmettre
    }
  }
  return { shares };
}

function shareUpdate(room, body, user) {
  if (typeof body.update !== "string") throw new HttpError(400, "invalid update");
  if (room.bytes + body.update.length > MAX_SHARE_BYTES) throw new HttpError(413, "share too large");
  // Le compteur du propriétaire est à jour : vérifié à chaque modification (avec ce qui n'est pas encore enregistré).
  if (usageOf(room.owner) + Math.max(0, room.bytes - room.stored) > MAX_USER_BYTES)
    throw new HttpError(413, "quota exceeded");
  const update = b64(body.update);
  try {
    Y.decodeUpdate(update);
  } catch {
    throw new HttpError(400, "invalid update");
  }
  Y.applyUpdate(room.doc, update);
  const now = Date.now();
  room.bytes += body.update.length;
  room.version++;
  room.dirty = true;
  room.used = now;
  room.timer ??= setTimeout(() => persistRoom(room), 3000);
  registerFiles(room.id, user.id, update);
  // Page partagée avant share_files : à la première modification d'un compte, ses fichiers déjà cités sont relevés.
  if (room.legacyFiles && !room.scanned.has(user.id)) {
    room.scanned.add(user.id);
    for (const file of citedFiles(Y.encodeStateAsUpdate(room.doc), Infinity))
      if (q.hasFile.get(user.id, file)) q.addShareFile.run(room.id, file, user.id);
  }
  // Seule une connexion de ce compte peut être exclue de l'envoi (c'est la sienne, qui a déjà la modification).
  const conn = typeof body.conn === "string" && room.clients.get(body.conn)?.user.id === user.id ? body.conn : null;
  broadcast(room, conn, { type: "update", update: body.update });
  return { ok: true };
}

/** Lit un message de présence (format y-protocols) : [{ clientID, clock, state }] ; lève une erreur s'il est mal formé. */
function readAwareness(bytes) {
  let pos = 0;
  const uint = () => {
    let n = 0;
    for (let unit = 1; ; unit *= 128) {
      if (pos >= bytes.length || unit > 2 ** 49) throw new Error("awareness");
      const b = bytes[pos++];
      n += (b & 127) * unit;
      if (b < 128) return n;
    }
  };
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  for (let count = uint(); count > 0; count--) {
    if (entries.length >= 8) throw new Error("awareness");
    const clientID = uint();
    const clock = uint();
    const length = uint();
    if (pos + length > bytes.length) throw new Error("awareness");
    const state = JSON.parse(utf8.decode(bytes.subarray(pos, pos + length)));
    pos += length;
    if (state !== null && (typeof state !== "object" || Array.isArray(state))) throw new Error("awareness");
    entries.push({ clientID, clock, state });
  }
  if (pos !== bytes.length) throw new Error("awareness");
  return entries;
}

function writeAwareness(entries) {
  const out = [];
  const uint = (n) => {
    for (; n > 127; n = Math.floor(n / 128)) out.push((n % 128) | 128);
    out.push(n);
  };
  uint(entries.length);
  for (const { clientID, clock, state } of entries) {
    uint(clientID);
    uint(clock);
    const json = Buffer.from(JSON.stringify(state));
    uint(json.length);
    for (const b of json) out.push(b);
  }
  return Buffer.from(out).toString("base64");
}

/**
 * Relaie la présence (curseur, nom) d'un participant. Chaque identifiant Yjs appartient à la
 * connexion qui l'a annoncé en premier : personne ne peut déplacer le curseur d'un autre. Le nom
 * affiché est celui du compte ; un lecteur annonce sa présence, sans curseur ni autre donnée.
 */
function relayAwareness(room, user, role, body) {
  const { conn, update } = body;
  if (typeof update !== "string" || update.length > AWARENESS_MAX) throw new HttpError(413, "awareness too large");
  const client = typeof conn === "string" ? room.clients.get(conn) : undefined;
  if (!client || client.user.id !== user.id) return; // pas de flux ouvert par ce compte : personne à qui l'attribuer
  if (!awarenessHits.take(conn)) throw new HttpError(429, "too many requests");
  let entries;
  try {
    entries = readAwareness(b64(update));
  } catch {
    throw new HttpError(400, "invalid awareness");
  }
  const kept = [];
  for (const { clientID, clock, state } of entries) {
    const claim = room.awareness.get(clientID);
    if (claim ? claim.conn !== conn : [...room.awareness.values()].filter((c) => c.conn === conn).length >= 2) continue;
    room.awareness.set(clientID, { conn, clock });
    let clean = state;
    if (state) {
      const color =
        typeof state.user?.color === "string" && state.user.color.length <= 32 ? state.user.color : undefined;
      clean = { ...(role === "view" ? {} : state), user: { name: user.username, color } };
    }
    kept.push({ clientID, clock, state: clean });
  }
  if (kept.length > 0) broadcast(room, conn, { type: "awareness", update: writeAwareness(kept) });
}

/** Retire la présence d'une connexion fermée, pour que son curseur disparaisse chez les autres. */
function releaseAwareness(room, conn) {
  const gone = [];
  for (const [clientID, claim] of room.awareness)
    if (claim.conn === conn) {
      room.awareness.delete(clientID);
      gone.push({ clientID, clock: claim.clock, state: null });
    }
  if (gone.length > 0) broadcast(room, conn, { type: "awareness", update: writeAwareness(gone) });
}

// ---------- Connecteur MCP (Claude, Codex…) ----------
// Protocole « Streamable HTTP » sans état : chaque requête JSON-RPC reçoit une réponse JSON.
const uuid = () =>
  randomBytes(16)
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

/** Messages par requête groupée, et éléments créés par appel d'outil. */
const MCP_BATCH = 10;
const MCP_MAX_CARDS = 200;
const MCP_MAX_QUESTIONS = 100;

/**
 * Écrit des lignes dans les données du compte, en une seule transaction et avec un seul contrôle
 * de l'espace (taille totale ajoutée) ; les appareils les recevront à leur prochaine synchronisation.
 */
function putRecords(user, rows) {
  const items = rows.map(({ tbl, id, data }) => ({ tbl, id, json: JSON.stringify(data) }));
  transaction(user.id, (next) => {
    let added = 0;
    for (const { tbl, id, json } of items) added += byteLength(json) - byteLength(q.record.get(user.id, tbl, id)?.data);
    if (usageOf(user.id) + added > MAX_USER_BYTES) throw new HttpError(413, "Espace de stockage du compte dépassé");
    const now = Date.now();
    for (const { tbl, id, json } of items) q.put.run(user.id, tbl, id, json, now, next());
    addUsage(user.id, added);
  });
}
const putRecord = (user, tbl, id, data) => putRecords(user, [{ tbl, id, data }]);

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
          maxItems: MCP_MAX_CARDS,
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
      if (Array.isArray(cards) && cards.length > MCP_MAX_CARDS)
        throw new HttpError(400, `Au plus ${MCP_MAX_CARDS} cartes par appel : découpe la liste en plusieurs appels.`);
      const rows = [];
      for (const c of Array.isArray(cards) ? cards : []) {
        const front = text(c?.front, 10_000).trim();
        const back = text(c?.back, 10_000).trim();
        if (!front || !back) continue;
        const id = `extra:${uuid()}`;
        rows.push({ tbl: "cards", id, data: { id, page_id, front, back, fsrs, due: now, created_at: now } });
      }
      putRecords(user, rows);
      return { created: rows.length };
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
          maxItems: MCP_MAX_QUESTIONS,
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
      if (Array.isArray(questions) && questions.length > MCP_MAX_QUESTIONS)
        throw new HttpError(400, `Au plus ${MCP_MAX_QUESTIONS} questions par quiz.`);
      const clean = (Array.isArray(questions) ? questions : [])
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
 * adresse). Connexions : ce serveur seulement (l'application qu'il sert se synchronise avec lui),
 * plus les origines de CSP_CONNECT_SRC pour qui synchronise cette application web avec un autre
 * serveur. Un script injecté ne peut donc pas envoyer les notes ailleurs.
 */
const CONNECT_EXTRA = (env.CSP_CONNECT_SRC ?? "")
  .split(/[\s,]+/)
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter((o) => /^https?:\/\/[\w.-]+(:\d+)?$/.test(o));
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  `connect-src 'self' ${CONNECT_EXTRA.map((o) => `${o} `).join("")}data: blob:`,
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

/**
 * Chemin d'API ou du connecteur tel qu'il a été envoyé : rien que des segments `[\w-]`. Le parseur
 * d'URL transforme `\` en `/` et résout `%2e%2e` ou `..` : sans ce contrôle, un identifiant forgé
 * (`<id>\delete`, `%2e%2e\logout`) atteindrait une autre route que celle visée par l'application.
 */
const API_PATH = /^(?:\/[\w-]+)+$/;

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
  const ip = ipKey(clientIp(req));

  if ((isApi || isMcp) && (String(req.url).split("?")[0] !== path || !API_PATH.test(path)))
    throw new HttpError(400, "bad path");

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
    if (!Array.isArray(body)) {
      const out = mcpMessage(user, body);
      return out === null ? void res.writeHead(202, { ...SECURITY, ...cors }).end() : send(200, out);
    }
    // Requête groupée : quelques messages au plus, chacun compté dans la limite par minute.
    const out = body
      .map((m, i) => {
        if (i >= MCP_BATCH || (i > 0 && !mcpHits.take(user.id)))
          return m?.id === undefined
            ? null
            : {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32000, message: i >= MCP_BATCH ? "batch too large" : "too many requests" },
              };
        return mcpMessage(user, m);
      })
      .filter(Boolean);
    if (out.length === 0) return void res.writeHead(202, { ...SECURITY, ...cors }).end();
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
    if (!pub[2]) return send(200, { title: row.title, ydoc: shareState(row) });
    if (!citesFile(row, pub[2])) throw new HttpError(404, "not found");
    const record = q.sharedFile.get(row.id, pub[2], row.owner_id);
    if (!record) throw new HttpError(404, "not found");
    return sendFile(res, record, {});
  }
  // Fichier d'une page partagée, pour ses participants (il est dans le compte de celui qui l'a ajouté).
  const sharedFile = /^\/api\/share\/([\w-]+)\/file\/([\w-]+)$/.exec(path);
  if (sharedFile && req.method === "GET") {
    const { user } = authenticate(bearer(req));
    const { share: row } = shareAccess(sharedFile[1], user);
    if (!citesFile(row, sharedFile[2])) throw new HttpError(404, "not found");
    const record = q.sharedFile.get(row.id, sharedFile[2], row.owner_id);
    if (!record) throw new HttpError(404, "not found");
    return sendFile(res, record, cors);
  }
  const stream = /^\/api\/share\/([\w-]+)\/stream$/.exec(path);
  if (stream && req.method === "GET") {
    const auth = authenticate(bearer(req));
    const { share, role } = shareAccess(stream[1], auth.user, { join: "open" });
    return shareStream(openRoom(share, auth.user), req, res, auth, role, { ...SECURITY, ...cors });
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
      closeRevokedStreams();
      return send(200, { ok: true });
    case "/api/logout-others": {
      // Toutes les autres sessions et tous les jetons MCP : l'un d'eux a pu être créé depuis un appareil volé.
      const mcp = q.otherMcp.get(user.id, auth.hash).n;
      const revoked = Number(q.dropOtherTokens.run(user.id, auth.hash).changes);
      closeRevokedStreams();
      return send(200, { ok: true, revoked: revoked - mcp, mcp });
    }
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
  const share =
    /^\/api\/share\/([\w-]+)(?:\/(update|awareness|delete|public|access|member|leave|invite|preview))?$/.exec(path);
  if (!share) throw new HttpError(404, "not found");
  const [, id, action] = share;
  if (action === "delete") {
    deleteShare(ownedShare(id, user));
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
  if (action === "invite") {
    // Nouveau secret d'invitation : l'ancien lien ne permet plus de rejoindre ; les participants restent.
    ownedShare(id, user);
    const invite = randomBytes(16).toString("base64url");
    q.setInvite.run(invite, id);
    return send(200, { invite });
  }
  if (action === "leave") {
    // Un participant quitte la page : il n'y a plus accès, et ses fichiers n'y sont plus servis.
    const row = q.share.get(id);
    if (!row) throw new HttpError(404, "share not found");
    if (row.owner_id === user.id) throw new HttpError(400, "owner cannot leave");
    q.leave.run(id, user.id, Date.now());
    q.dropMemberFiles.run(id, user.id);
    refreshRoles(id);
    return send(200, { ok: true });
  }
  const body = await readJson(req, action === "update" ? SHARE_BODY : SMALL_BODY);
  const invite = typeof body.invite === "string" ? body.invite : undefined;
  if (action === "preview") {
    // Aperçu d'une invitation, sans rien changer : titre et propriétaire, si ce compte peut la rejoindre.
    const row = q.share.get(id);
    if (!row) throw new HttpError(404, "share not found");
    const role = roleOf(row, user);
    const member = role !== "none" && (role === "owner" || !!q.member.get(id, user.id));
    const removed = q.member.get(id, user.id)?.role === "none";
    if (!member && (removed || !invited(row, invite))) throw new HttpError(403, "forbidden");
    return send(200, { title: row.title, owner: q.ownerName.get(row.owner_id)?.username ?? "", member });
  }
  // Lire ou modifier : le droit du compte est vérifié à chaque requête.
  const { share: row, role } = shareAccess(id, user, {
    write: action === "update",
    join: action ? undefined : "link",
    invite,
  });
  if (action === "update") return send(200, shareUpdate(openRoom(row, user), body, user));
  if (action === "awareness") {
    // Personne n'est connecté à une salle fermée : rien à relayer.
    const room = rooms.get(id);
    if (room) relayAwareness(room, user, role, body);
    return send(200, { ok: true });
  }
  return send(200, {
    title: row.title,
    owner: role === "owner",
    role,
    access: row.access,
    public: !!row.public,
    members: role === "owner" ? q.members.all(id) : undefined,
    // Le secret d'invitation, pour que le lien donné par l'application reste valable.
    invite: row.invite ?? undefined,
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
  if (TOKEN_TTL > 0 && q.expireTokens.run(now - TOKEN_TTL).changes > 0) closeRevokedStreams();
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
