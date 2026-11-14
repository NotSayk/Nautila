// Tests du serveur : chaque groupe lance un vrai serveur sur une base temporaire.
//   cd server && npm test
import { spawn } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";

const SERVER = new URL("../index.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dirs = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nautila-test-"));
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Lance le serveur et attend qu'il écoute ; renvoie son adresse. */
function start(env = {}, dataFile = join(tempDir(), "test.db")) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: "0", DATA_FILE: dataFile, NODE_NO_WARNINGS: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    proc.stdout.on("data", (d) => {
      out += d;
      const port = /port (\d+)/.exec(out)?.[1];
      if (port)
        resolve({
          url: `http://127.0.0.1:${port}`,
          stop: () => new Promise((r) => (proc.on("exit", r), proc.kill())),
          logs: () => out + err,
        });
    });
    proc.on("exit", (code) => reject(new Error(`serveur arrêté (${code}) : ${out}${err}`)));
  });
}

/** Requête HTTP brute : renvoie statut, en-têtes et corps (JSON si possible). */
function call(base, path, { method = "POST", body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      `${base}${path}`,
      {
        method,
        headers: {
          ...(data !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let json;
          try {
            json = JSON.parse(raw.toString("utf8"));
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, json, raw });
        });
      },
    );
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

const PASSWORD = "correct-horse-battery";
const fileRow = (id, mime, content, name = "f") => ({
  tbl: "files",
  id,
  at: Date.now(),
  data: { id, name, mime, data: Buffer.from(content).toString("base64"), created_at: 1 },
});

describe("serveur", () => {
  let srv;
  let base;
  let ipCounter = 0;
  /** Chaque test parle depuis sa propre adresse, pour ne pas partager les compteurs d'échecs. */
  const fromNewIp = () => ({ "X-Forwarded-For": `10.0.0.${++ipCounter}` });
  const account = async (username) => {
    const res = await call(base, "/api/register", {
      body: { username, password: PASSWORD },
      headers: fromNewIp(),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.token;
  };

  before(async () => {
    const web = tempDir();
    mkdirSync(join(web, "assets"));
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Nautila</title>");
    writeFileSync(join(web, "assets", "app.js"), "console.log(1)");
    srv = await start({
      STATIC_DIR: web,
      REGISTRATION: "open",
      TRUST_PROXY: "1",
      LOGIN_MAX_PER_USER: "3",
      LOGIN_MAX_PER_IP: "5",
    });
    base = srv.url;
  });
  after(() => srv.stop());

  it("ajoute les en-têtes de sécurité et la CSP de l'application", async () => {
    const health = await call(base, "/api/health", { method: "GET" });
    assert.equal(health.status, 200);
    assert.equal(health.headers["x-content-type-options"], "nosniff");
    assert.equal(health.headers["x-frame-options"], "DENY");
    assert.equal(health.headers["referrer-policy"], "no-referrer");
    assert.equal(health.headers["access-control-allow-origin"], "*");
    const page = await call(base, "/", { method: "GET" });
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.headers["content-security-policy"], /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  });

  it("sert les fichiers statiques sans traversée ni page d'entrée à la place d'un asset", async () => {
    assert.equal((await call(base, "/assets/app.js", { method: "GET" })).status, 200);
    const missing = await call(base, "/assets/disparu-123.js", { method: "GET" });
    assert.equal(missing.status, 404);
    assert.equal((await call(base, "/%E0%A4%A", { method: "GET" })).status, 400);
    const traversal = await call(base, "/..%2f..%2fpackage.json", { method: "GET" });
    assert.ok([403, 404].includes(traversal.status) || !traversal.raw.includes("nautila-server"));
    const route = await call(base, "/une/route", { method: "GET" });
    assert.match(route.raw.toString(), /<title>Nautila<\/title>/);
  });

  it("inscrit, refuse les mots de passe faibles et répond pareil pour un compte inconnu", async () => {
    const weak = await call(base, "/api/register", {
      body: { username: "faible", password: "12345678" },
      headers: fromNewIp(),
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.json.error, "weak password");
    await account("alice");
    const ip = fromNewIp();
    const wrong = await call(base, "/api/login", { body: { username: "alice", password: "pas-le-bon-1" }, headers: ip });
    const unknown = await call(base, "/api/login", { body: { username: "inconnu", password: "pas-le-bon-1" }, headers: ip });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.json, unknown.json);
    const ok = await call(base, "/api/login", { body: { username: "alice", password: PASSWORD }, headers: ip });
    assert.equal(ok.status, 200);
  });

  it("limite les échecs par identifiant et par adresse", async () => {
    await account("bob");
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await call(base, "/api/login", { body: { username: "bob", password: "mauvais-mdp" }, headers: fromNewIp() }))
          .status,
        401,
      );
    // Bloqué même avec le bon mot de passe, et depuis une autre adresse.
    const blocked = await call(base, "/api/login", { body: { username: "bob", password: PASSWORD }, headers: fromNewIp() });
    assert.equal(blocked.status, 429);
    const ip = fromNewIp();
    for (let i = 0; i < 5; i++)
      await call(base, "/api/login", { body: { username: `x${i}xx`, password: "mauvais-mdp" }, headers: ip });
    const byIp = await call(base, "/api/login", { body: { username: "alice", password: PASSWORD }, headers: ip });
    assert.equal(byIp.status, 429);
  });

  it("refuse un corps trop gros avant de le lire", async () => {
    const res = await call(base, "/api/login", {
      body: { username: "alice", password: "x".repeat(20_000) },
      headers: fromNewIp(),
    });
    assert.equal(res.status, 413);
  });

  it("donne des numéros de séquence distincts à deux synchronisations simultanées", async () => {
    const token = await account("carole");
    const rows = (prefix) =>
      Array.from({ length: 5 }, (_, i) => ({ tbl: "tasks", id: `${prefix}${i}`, at: Date.now(), data: { id: `${prefix}${i}` } }));
    // Les deux requêtes sont authentifiées avant que l'une ou l'autre n'envoie son corps.
    const slow = (changes) =>
      new Promise((resolve, reject) => {
        const data = JSON.stringify({ since: 0, changes });
        const req = request(
          `${base}/api/sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), Authorization: `Bearer ${token}` },
          },
          (res) => {
            res.resume();
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.flushHeaders();
        setTimeout(() => req.end(data), 200);
      });
    await Promise.all([slow(rows("a")), slow(rows("b"))]);
    const pull = await call(base, "/api/sync", { body: { since: 0, changes: [] }, token });
    assert.equal(pull.json.changes.length, 10);
    assert.equal(pull.json.seq, 10);
  });

  it("isole les jetons MCP et permet de les révoquer", async () => {
    const token = await account("david");
    const { json } = await call(base, "/api/token", { token });
    assert.equal((await call(base, "/api/sync", { body: { since: 0 }, token: json.token })).status, 401);
    const mcp = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    assert.equal((await call(base, "/mcp", { body: mcp, token: json.token })).status, 200);
    assert.equal((await call(base, `/mcp/${json.token}`, { body: mcp })).status, 200);
    const created = await call(base, "/mcp", {
      token: json.token,
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_page", arguments: { title: "Fiche", markdown: "# Bonjour" } } },
    });
    assert.equal(created.json.result.isError, undefined);
    const pages = await call(base, "/mcp", {
      token: json.token,
      body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_notes", arguments: { query: "bonjour" } } },
    });
    assert.match(pages.json.result.content[0].text, /Fiche/);
    const list = await call(base, "/api/tokens", { token });
    assert.equal(list.json.tokens.length, 1);
    await call(base, "/api/token/revoke", { token, body: { id: list.json.tokens[0].id } });
    assert.equal((await call(base, "/mcp", { body: mcp, token: json.token })).status, 401);
  });

  it("change le mot de passe et ferme les autres sessions", async () => {
    const first = await account("emma");
    const second = (await call(base, "/api/login", { body: { username: "emma", password: PASSWORD }, headers: fromNewIp() }))
      .json.token;
    const bad = await call(base, "/api/password", { token: first, body: { current: "faux-mdp-123", password: "nouveau-secret-42" } });
    assert.equal(bad.status, 403);
    const ok = await call(base, "/api/password", { token: first, body: { current: PASSWORD, password: "nouveau-secret-42" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.revoked, 1);
    assert.equal((await call(base, "/api/sync", { body: { since: 0 }, token: second })).status, 401);
    assert.equal((await call(base, "/api/sync", { body: { since: 0 }, token: first })).status, 200);
    const relogin = await call(base, "/api/login", { body: { username: "emma", password: "nouveau-secret-42" }, headers: fromNewIp() });
    assert.equal(relogin.status, 200);
    const others = await call(base, "/api/logout-others", { token: first });
    assert.equal(others.json.revoked, 1);
    assert.equal((await call(base, "/api/sync", { body: { since: 0 }, token: relogin.json.token })).status, 401);
  });

  it("sert les fichiers des pages publiques sans exécuter de contenu actif", async () => {
    const token = await account("felix");
    const html = "aaaaaaaa-0000-4000-8000-000000000001";
    const png = "aaaaaaaa-0000-4000-8000-000000000002";
    const secret = "aaaaaaaa-0000-4000-8000-000000000003";
    await call(base, "/api/sync", {
      token,
      body: {
        since: 0,
        changes: [
          fileRow(html, "text/html", "<script>alert(1)</script>", "piège.html"),
          fileRow(png, "image/png", "png"),
          fileRow(secret, "image/png", "secret"),
        ],
      },
    });
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("doc");
    for (const id of [html, png]) {
      const el = new Y.XmlElement("image");
      el.setAttribute("url", `nautila-file:${id}`);
      frag.push([el]);
    }
    const ydoc = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    const { json: share } = await call(base, "/api/share", { token, body: { title: "T", ydoc } });
    assert.equal((await call(base, `/api/public/${share.id}`, { method: "GET" })).status, 404);
    await call(base, `/api/share/${share.id}/public`, { token, body: { public: true } });
    const page = await call(base, `/api/public/${share.id}`, { method: "GET" });
    assert.equal(page.status, 200);
    assert.equal(page.headers["access-control-allow-origin"], undefined);

    const trap = await call(base, `/api/public/${share.id}/file/${html}`, { method: "GET" });
    assert.equal(trap.headers["content-type"], "application/octet-stream");
    assert.match(trap.headers["content-disposition"], /^attachment/);
    assert.equal(trap.headers["x-content-type-options"], "nosniff");
    assert.match(trap.headers["content-security-policy"], /sandbox/);
    const image = await call(base, `/api/public/${share.id}/file/${png}`, { method: "GET" });
    assert.equal(image.headers["content-type"], "image/png");
    assert.match(image.headers["content-disposition"], /^inline/);
    // Un fichier du compte que la page ne cite pas reste privé.
    assert.equal((await call(base, `/api/public/${share.id}/file/${secret}`, { method: "GET" })).status, 404);
    const shared = await call(base, `/api/share/${share.id}/file/${html}`, { method: "GET", token });
    assert.equal(shared.headers["content-type"], "application/octet-stream");
  });

  it("contrôle les droits et la validité des modifications d'une page partagée", async () => {
    const owner = await account("gina");
    const guest = await account("hugo");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    assert.equal((await call(base, `/api/share/${share.id}/public`, { token: guest, body: { public: true } })).status, 403);
    assert.equal((await call(base, `/api/share/${share.id}/delete`, { token: guest, body: {} })).status, 403);
    await call(base, `/api/share/${share.id}`, { token: guest, body: {} }); // rejoint la page
    await call(base, `/api/share/${share.id}/access`, { token: owner, body: { access: "view" } });
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x");
    const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
    assert.equal((await call(base, `/api/share/${share.id}/update`, { token: guest, body: { update } })).status, 403);
    assert.equal((await call(base, `/api/share/${share.id}/update`, { token: owner, body: { update } })).status, 200);
    const junk = await call(base, `/api/share/${share.id}/update`, { token: owner, body: { update: "////" } });
    assert.equal(junk.status, 400);
    assert.equal((await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: "////" } })).status, 400);
  });
});

describe("configuration", () => {
  it("ferme les inscriptions si le code d'invitation vaut la valeur d'exemple", async () => {
    const srv = await start({ REGISTRATION: "invite", INVITE_CODE: "change-moi" });
    try {
      const health = await call(srv.url, "/api/health", { method: "GET" });
      assert.equal(health.json.registration, "closed");
      assert.match(srv.logs(), /INVITE_CODE/);
      const res = await call(srv.url, "/api/register", { body: { username: "zoe", password: PASSWORD, invite: "change-moi" } });
      assert.equal(res.status, 403);
    } finally {
      await srv.stop();
    }
  });

  it("garde un vrai code d'invitation", async () => {
    const srv = await start({ INVITE_CODE: "un-vrai-code" });
    try {
      assert.equal((await call(srv.url, "/api/health", { method: "GET" })).json.registration, "invite");
      const no = await call(srv.url, "/api/register", { body: { username: "zoe", password: PASSWORD, invite: "faux" } });
      assert.equal(no.status, 403);
      const yes = await call(srv.url, "/api/register", { body: { username: "zoe", password: PASSWORD, invite: "un-vrai-code" } });
      assert.equal(yes.status, 200);
    } finally {
      await srv.stop();
    }
  });

  it("fait expirer un jeton inutilisé", async () => {
    const srv = await start({ REGISTRATION: "open", TOKEN_TTL_DAYS: String(1 / 86400) }); // une seconde
    try {
      const { json } = await call(srv.url, "/api/register", { body: { username: "yann", password: PASSWORD } });
      assert.equal((await call(srv.url, "/api/sync", { body: { since: 0 }, token: json.token })).status, 200);
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal((await call(srv.url, "/api/sync", { body: { since: 0 }, token: json.token })).status, 401);
    } finally {
      await srv.stop();
    }
  });

  it("reprend une base créée par la version 0.2.5 sans déconnecter ses appareils", async () => {
    const file = join(tempDir(), "ancienne.db");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE tokens (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE records (user_id INTEGER NOT NULL, tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT, at INTEGER NOT NULL,
        seq INTEGER NOT NULL, PRIMARY KEY (user_id, tbl, id));
      CREATE TABLE shares (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, title TEXT NOT NULL, ydoc TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    const salt = randomBytes(16).toString("hex");
    old.prepare("INSERT INTO users (username, salt, hash, created_at) VALUES ('ancien', ?, ?, 0)").run(
      salt,
      scryptSync(PASSWORD, salt, 64).toString("hex"),
    );
    const token = randomBytes(32).toString("base64url");
    // Jeton créé il y a deux ans : il ne doit pas expirer à la mise à jour.
    old.prepare("INSERT INTO tokens (hash, user_id, created_at) VALUES (?, 1, ?)").run(
      createHash("sha256").update(token).digest("hex"),
      Date.now() - 730 * 86_400_000,
    );
    old.close();
    for (let run = 0; run < 2; run++) {
      const srv = await start({}, file);
      try {
        assert.equal((await call(srv.url, "/api/sync", { body: { since: 0 }, token })).status, 200);
        const mcp = await call(srv.url, `/mcp/${token}`, { body: { jsonrpc: "2.0", id: 1, method: "ping" } });
        assert.equal(mcp.status, 200);
        const login = await call(srv.url, "/api/login", { body: { username: "ancien", password: PASSWORD } });
        assert.equal(login.status, 200);
      } finally {
        await srv.stop();
      }
    }
  });
});
