// Tests des corrections de la relecture de sécurité : chaque groupe lance un vrai serveur.
//   cd server && npm test
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { PASSWORD, call, docCiting, fileRow, openStream, start, tempDir, until, wait } from "./helpers.mjs";

let ipCounter = 0;
const fromNewIp = () => ({ "X-Forwarded-For": `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });
const register = async (base, username) => {
  const res = await call(base, "/api/register", { body: { username, password: PASSWORD }, headers: fromNewIp() });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.token;
};
const login = async (base, username) =>
  (await call(base, "/api/login", { body: { username, password: PASSWORD }, headers: fromNewIp() })).json.token;
const tool = (base, token, name, args, id = 1) =>
  call(base, "/mcp", { token, body: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } } });
const newPage = async (base, token) =>
  JSON.parse((await tool(base, token, "create_page", { title: "Cours", markdown: "x" })).json.result.content[0].text)
    .id;
const cardsOf = async (base, token, pageId) =>
  JSON.parse((await tool(base, token, "read_page", { page_id: pageId })).json.result.content[0].text).flashcards.length;
const textUpdate = (content) => {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, content);
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
};

/** Message de présence au format y-protocols (entier variable, puis état JSON). */
function awareness(entries) {
  const out = [];
  const uint = (n) => {
    for (; n > 127; n = Math.floor(n / 128)) out.push((n % 128) | 128);
    out.push(n);
  };
  uint(entries.length);
  for (const { clientID, clock = 1, state } of entries) {
    uint(clientID);
    uint(clock);
    const json = Buffer.from(JSON.stringify(state));
    uint(json.length);
    out.push(...json);
  }
  return Buffer.from(out).toString("base64");
}
function readAwareness(base64) {
  const bytes = Buffer.from(base64, "base64");
  let pos = 0;
  const uint = () => {
    let n = 0;
    for (let unit = 1; ; unit *= 128) {
      const b = bytes[pos++];
      n += (b & 127) * unit;
      if (b < 128) return n;
    }
  };
  const entries = [];
  for (let count = uint(); count > 0; count--) {
    const clientID = uint();
    const clock = uint();
    const length = uint();
    entries.push({ clientID, clock, state: JSON.parse(bytes.subarray(pos, pos + length).toString()) });
    pos += length;
  }
  return entries;
}

describe("sécurité", () => {
  let srv;
  let base;
  before(async () => {
    srv = await start({ REGISTRATION: "open", TRUST_PROXY: "1", LOGIN_MAX_PER_USER: "3", LOGIN_MAX_PER_IP: "5" });
    base = srv.url;
  });
  after(() => srv.stop());

  it("refuse les lots MCP trop longs et les appels trop gros", async () => {
    const token = await register(base, "mcp-lot");
    const ping = (id) => ({ jsonrpc: "2.0", id, method: "ping" });
    const batch = await call(base, "/mcp", { token, body: Array.from({ length: 11 }, (_, i) => ping(i)) });
    assert.equal(batch.json.length, 11);
    assert.equal(batch.json.filter((m) => m.result).length, 10);
    assert.equal(batch.json[10].error.message, "batch too large");
    const page = await newPage(base, token);
    const cards = (n) => Array.from({ length: n }, (_, i) => ({ front: `q${i}`, back: "r" }));
    const tooMany = await tool(base, token, "create_flashcards", { page_id: page, cards: cards(201) });
    assert.equal(tooMany.json.result.isError, true);
    assert.equal(await cardsOf(base, token, page), 0);
    const ok = await tool(base, token, "create_flashcards", { page_id: page, cards: cards(200) });
    assert.match(ok.json.result.content[0].text, /"created": 200/);
  });

  it("crée des cartes vite même dans un compte bien rempli", async () => {
    const token = await register(base, "mcp-plein");
    for (let i = 0; i < 4; i++) {
      const id = `dddddddd-0000-4000-8000-00000000000${i}`;
      const res = await call(base, "/api/sync", {
        token,
        body: { since: 0, changes: [fileRow(id, "image/png", Buffer.alloc(3 * 1024 * 1024, i + 1))] },
      });
      assert.equal(res.status, 200);
    }
    const page = await newPage(base, token);
    const cards = Array.from({ length: 200 }, (_, i) => ({ front: `q${i}`, back: "r" }));
    const msg = (id) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "create_flashcards", arguments: { page_id: page, cards } },
    });
    const t0 = Date.now();
    const res = await call(base, "/mcp", { token, body: [msg(1), msg(2), msg(3), msg(4), msg(5)] });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(await cardsOf(base, token, page), 1000);
    assert.ok(elapsed < 3000, `1000 cartes en ${elapsed} ms`);
  });

  it("ne fusionne qu'une fois une page répétée dans un lot de synchronisation", async () => {
    const token = await register(base, "lot-repete");
    const page = (ydoc) => ({ tbl: "pages", id: "p1", at: Date.now(), data: { id: "p1", title: "P", ydoc } });
    const big = textUpdate("w".repeat(3_000_000));
    assert.equal((await call(base, "/api/sync", { token, body: { since: 0, changes: [page(big)] } })).status, 200);
    const t0 = Date.now();
    const res = await call(base, "/api/sync", {
      token,
      body: { since: 1, changes: Array.from({ length: 300 }, (_, i) => page(textUpdate(`ajout ${i}`))) },
    });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 200);
    assert.equal(res.json.seq, 2);
    assert.ok(elapsed < 2000, `300 copies en ${elapsed} ms`);
  });

  it("ne laisse atteindre aucune route par un chemin normalisé", async () => {
    const owner = await register(base, "chemin");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    const forged = await call(base, `/api/share/${share.id}\\delete`, { token: owner, body: {} });
    assert.equal(forged.status, 400);
    assert.equal((await call(base, `/api/share/${share.id}`, { token: owner, body: {} })).status, 200);
    for (const path of [
      `/api/share/%2e%2e/logout`,
      `/api/share/${share.id}/..%2flogout`,
      `/api/share/x/../../logout`,
      "/api//logout",
    ])
      assert.equal((await call(base, path, { token: owner, body: {} })).status, 400, path);
    assert.equal((await call(base, "/api/sync", { token: owner, body: { since: 0 } })).status, 200);
  });

  it("ne sert d'une page partagée que les fichiers que leur propriétaire y a mis", async () => {
    const owner = await register(base, "proprio");
    const member = await register(base, "membre");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    await call(base, `/api/share/${share.id}`, { token: member, body: {} });
    await call(base, `/api/share/${share.id}/public`, { token: owner, body: { public: true } });
    // Fichier privé du participant, cité par le propriétaire qui en connaît l'identifiant.
    const secret = "bbbbbbbb-0000-4000-8000-00000000abcd";
    await call(base, "/api/sync", {
      token: member,
      body: { since: 0, changes: [fileRow(secret, "image/png", "PRIVE")] },
    });
    await call(base, `/api/share/${share.id}/update`, { token: owner, body: { update: docCiting(secret) } });
    assert.equal((await call(base, `/api/public/${share.id}/file/${secret}`, { method: "GET" })).status, 404);
    assert.equal(
      (await call(base, `/api/share/${share.id}/file/${secret}`, { method: "GET", token: owner })).status,
      404,
    );
    // Fichier que le participant met lui-même dans la page : servi aux autres.
    const mine = "bbbbbbbb-0000-4000-8000-00000000beef";
    await call(base, "/api/sync", {
      token: member,
      body: { since: 0, changes: [fileRow(mine, "image/png", "IMAGE")] },
    });
    await call(base, `/api/share/${share.id}/update`, { token: member, body: { update: docCiting(mine) } });
    const served = await call(base, `/api/share/${share.id}/file/${mine}`, { method: "GET", token: owner });
    assert.equal(served.status, 200);
    assert.equal(served.raw.toString(), "IMAGE");
    assert.equal((await call(base, `/api/public/${share.id}/file/${mine}`, { method: "GET" })).status, 200);
    // Le participant quitte la page : il n'y a plus accès, et son fichier n'y est plus servi.
    assert.equal((await call(base, `/api/share/${share.id}/leave`, { token: owner, body: {} })).status, 400);
    assert.equal((await call(base, `/api/share/${share.id}/leave`, { token: member, body: {} })).status, 200);
    assert.equal(
      (await call(base, `/api/share/${share.id}/file/${mine}`, { method: "GET", token: owner })).status,
      404,
    );
    assert.equal(
      (await call(base, `/api/shares/state`, { token: member, body: { shares: [{ id: share.id }] } })).json.shares[0]
        .role,
      "none",
    );
    const info = await call(base, `/api/share/${share.id}`, { token: owner, body: {} });
    assert.deepEqual(info.json.members, []);
    // Il peut revenir par le lien.
    assert.equal((await call(base, `/api/share/${share.id}`, { token: member, body: {} })).status, 200);
  });

  it("ferme les flux d'un jeton révoqué", async () => {
    await register(base, "flux");
    const first = await login(base, "flux");
    const second = await login(base, "flux");
    const third = await login(base, "flux");
    const { json: share } = await call(base, "/api/share", { token: first, body: { title: "T", ydoc: null } });
    const stolen = openStream(base, share.id, second);
    const other = openStream(base, share.id, third);
    await Promise.all([stolen.ready, other.ready]);
    assert.equal(stolen.status, 200);
    const pw = await call(base, "/api/password", {
      token: first,
      body: { current: PASSWORD, password: "nouveau-secret-42" },
    });
    assert.equal(pw.status, 200);
    assert.ok(await until(() => stolen.ended && other.ended, 2000), "flux fermés après le changement de mot de passe");
    // Déconnexion simple : le flux de ce jeton se ferme aussi.
    const fourth = (
      await call(base, "/api/login", {
        body: { username: "flux", password: "nouveau-secret-42" },
        headers: fromNewIp(),
      })
    ).json.token;
    const own = openStream(base, share.id, fourth);
    await own.ready;
    await call(base, "/api/logout", { token: fourth, body: {} });
    assert.ok(await until(() => own.ended, 2000), "flux fermé après la déconnexion");
  });

  it("révoque aussi les jetons MCP en déconnectant les autres appareils", async () => {
    const mine = await register(base, "autres");
    const stolen = await login(base, "autres");
    const { json } = await call(base, "/api/token", { token: stolen });
    const res = await call(base, "/api/logout-others", { token: mine });
    assert.deepEqual(res.json, { ok: true, revoked: 1, mcp: 1 });
    assert.equal(
      (await call(base, "/mcp", { token: json.token, body: { jsonrpc: "2.0", id: 1, method: "ping" } })).status,
      401,
    );
    assert.equal((await call(base, "/api/sync", { token: mine, body: { since: 0 } })).status, 200);
  });

  it("compte les essais de connexion simultanés avant le calcul", async () => {
    await register(base, "course");
    const headers = fromNewIp();
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(base, "/api/login", { body: { username: "course", password: `mauvais-${i}-mdp` }, headers }),
      ),
    );
    const refused = res.filter((r) => r.status === 401).length;
    assert.ok(refused <= 3, `${refused} essais vérifiés pour un plafond de 3`);
    assert.equal(res.filter((r) => r.status === 429).length, 20 - refused);
  });

  it("regroupe les adresses IPv6 par /64", async () => {
    await register(base, "ipv6");
    for (let i = 1; i <= 5; i++)
      await call(base, "/api/login", {
        body: { username: `inconnu${i}`, password: "mauvais-mdp" },
        headers: { "X-Forwarded-For": `2001:db8:7:7::${i}` },
      });
    const next = await call(base, "/api/login", {
      body: { username: "ipv6", password: PASSWORD },
      headers: { "X-Forwarded-For": "2001:db8:7:7:aaaa:bbbb:cccc:dddd" },
    });
    assert.equal(next.status, 429);
    const elsewhere = await call(base, "/api/login", {
      body: { username: "ipv6", password: PASSWORD },
      headers: { "X-Forwarded-For": "2001:db8:7:8::1" },
    });
    assert.equal(elsewhere.status, 200);
  });

  it("traite chaque page une seule fois dans /api/shares/state", async () => {
    const owner = await register(base, "etat");
    const { json: share } = await call(base, "/api/share", {
      token: owner,
      body: { title: "T", ydoc: textUpdate("bonjour") },
    });
    const res = await call(base, "/api/shares/state", {
      token: owner,
      body: { shares: [...Array.from({ length: 500 }, () => ({ id: share.id, sv: "" })), { id: "../x" }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.shares.length, 1);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(res.json.shares[0].update, "base64"));
    assert.equal(doc.getText("t").toString(), "bonjour");
    // Avec le vecteur d'état du document : rien de nouveau à transmettre.
    const again = await call(base, "/api/shares/state", {
      token: owner,
      body: { shares: [{ id: share.id, sv: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }] },
    });
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Buffer.from(again.json.shares[0].update, "base64"));
    assert.equal(copy.getText("t").toString(), "");
  });

  it("contrôle les messages de présence", async () => {
    const owner = await register(base, "pres-proprio");
    const viewer = await register(base, "pres-lecteur");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    await call(base, `/api/share/${share.id}/access`, { token: owner, body: { access: "view" } });
    const ownStream = openStream(base, share.id, owner);
    const viewStream = openStream(base, share.id, viewer);
    await Promise.all([ownStream.ready, viewStream.ready]);
    const ownConn = ownStream.frames[0].conn;
    const viewConn = viewStream.frames[0].conn;
    const post = (token, conn, update) =>
      call(base, `/api/share/${share.id}/awareness`, { token, body: { conn, update } });

    assert.equal((await post(viewer, viewConn, "AAAA-n'importe-quoi")).status, 400);
    assert.equal((await post(viewer, viewConn, "A".repeat(5000))).status, 413);
    // Le propriétaire annonce son curseur ; le lecteur tente de le reprendre, puis annonce le sien.
    await post(
      owner,
      ownConn,
      awareness([{ clientID: 111, state: { user: { name: "pres-proprio" }, cursor: { a: 1 } } }]),
    );
    await post(
      viewer,
      viewConn,
      awareness([{ clientID: 111, state: { user: { name: "pres-proprio" }, cursor: { a: 9 } } }]),
    );
    const fake = {
      user: { name: "quelqu-un-d-autre", color: "#ff0000" },
      cursor: { anchor: 3 },
      extra: "x".repeat(100),
    };
    assert.equal((await post(viewer, viewConn, awareness([{ clientID: 222, state: fake }]))).status, 200);
    // Connexion d'un autre compte : rien n'est relayé.
    await post(viewer, ownConn, awareness([{ clientID: 333, state: { user: { name: "x" } } }]));
    assert.ok(await until(() => ownStream.frames.some((f) => f.type === "awareness"), 2000));
    await wait(200);
    const seen = ownStream.frames.filter((f) => f.type === "awareness").flatMap((f) => readAwareness(f.update));
    assert.deepEqual(seen, [{ clientID: 222, clock: 1, state: { user: { name: "pres-lecteur", color: "#ff0000" } } }]);
    const toViewer = viewStream.frames.filter((f) => f.type === "awareness").flatMap((f) => readAwareness(f.update));
    assert.deepEqual(
      toViewer.map((e) => e.clientID),
      [111],
    );
    // Débit limité par connexion.
    const statuses = [];
    for (let i = 0; i < 45; i++)
      statuses.push((await post(viewer, viewConn, awareness([{ clientID: 222, clock: i + 2, state: {} }]))).status);
    assert.ok(statuses.includes(429));
    ownStream.close();
    viewStream.close();
  });

  it("régénère le lien d'invitation sans retirer les participants", async () => {
    const owner = await register(base, "lien-proprio");
    const member = await register(base, "lien-ancien");
    const newcomer = await register(base, "lien-nouveau");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "Mon cours", ydoc: null } });
    assert.equal((await call(base, `/api/share/${share.id}`, { token: member, body: {} })).status, 200);
    assert.equal((await call(base, `/api/share/${share.id}/invite`, { token: member, body: {} })).status, 403);
    const { json } = await call(base, `/api/share/${share.id}/invite`, { token: owner, body: {} });
    assert.match(json.invite, /^[\w-]{22}$/);
    // L'ancien lien ne suffit plus pour un nouveau venu.
    assert.equal((await call(base, `/api/share/${share.id}/preview`, { token: newcomer, body: {} })).status, 403);
    assert.equal((await call(base, `/api/share/${share.id}`, { token: newcomer, body: {} })).status, 403);
    assert.equal(
      (await call(base, `/api/share/${share.id}/update`, { token: newcomer, body: { update: textUpdate("x") } }))
        .status,
      403,
    );
    const refused = openStream(base, share.id, newcomer);
    await refused.ready;
    assert.equal(refused.status, 403);
    // Aperçu avec le nouveau lien : titre et propriétaire, sans inscrire le compte.
    const preview = await call(base, `/api/share/${share.id}/preview`, {
      token: newcomer,
      body: { invite: json.invite },
    });
    assert.deepEqual(preview.json, { title: "Mon cours", owner: "lien-proprio", member: false });
    assert.equal((await call(base, `/api/share/${share.id}`, { token: owner, body: {} })).json.members.length, 1);
    assert.equal(
      (await call(base, `/api/share/${share.id}`, { token: newcomer, body: { invite: json.invite } })).status,
      200,
    );
    // L'ancien participant garde son accès, et reçoit le lien en vigueur.
    const kept = await call(base, `/api/share/${share.id}`, { token: member, body: {} });
    assert.equal(kept.status, 200);
    assert.equal(kept.json.invite, json.invite);
  });

  it("ferme un flux qui ne lit plus", async () => {
    const owner = await register(base, "lent");
    const { json: share } = await call(base, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    const sock = net.connect(srv.port, "127.0.0.1");
    sock.write(`GET /api/share/${share.id}/stream HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${owner}\r\n\r\n`);
    sock.pause();
    let closed = false;
    sock.on("close", () => (closed = true));
    sock.on("error", () => (closed = true));
    await wait(300);
    const watcher = openStream(base, share.id, owner);
    await watcher.ready;
    assert.equal(watcher.frames[0].peers, 2);
    const big = "x".repeat(400_000);
    for (let i = 0; i < 40 && !watcher.frames.some((f) => f.type === "peers" && f.peers === 1); i++)
      await call(base, `/api/share/${share.id}/update`, { token: owner, body: { update: textUpdate(big + i) } });
    assert.ok(await until(() => watcher.frames.some((f) => f.type === "peers" && f.peers === 1), 3000));
    watcher.close();
    sock.destroy();
  });
});

describe("politique de sécurité de l'application web", () => {
  it("limite les connexions à ce serveur, plus les origines déclarées", async () => {
    const web = tempDir();
    writeFileSync(join(web, "index.html"), "<!doctype html><title>Nautila</title>");
    const srv = await start({ STATIC_DIR: web, CSP_CONNECT_SRC: "https://autre.example, javascript:x" });
    try {
      const csp = (await call(srv.url, "/", { method: "GET" })).headers["content-security-policy"];
      const connect = csp.split("; ").find((d) => d.startsWith("connect-src"));
      assert.equal(connect, "connect-src 'self' https://autre.example data: blob:");
    } finally {
      await srv.stop();
    }
  });
});

describe("limites par compte", () => {
  it("vérifie l'espace une fois pour tout l'appel MCP, sans écriture partielle", async () => {
    const srv = await start({ REGISTRATION: "open", MAX_USER_MB: "1" });
    try {
      const token = await register(srv.url, "quota");
      const file = "eeeeeeee-0000-4000-8000-000000000001";
      const put = await call(srv.url, "/api/sync", {
        token,
        body: { since: 0, changes: [fileRow(file, "image/png", Buffer.alloc(650_000, 1))] },
      });
      assert.equal(put.status, 200);
      const page = await newPage(srv.url, token);
      const cards = Array.from({ length: 200 }, (_, i) => ({ front: `${i} ${"q".repeat(1500)}`, back: "r" }));
      const full = await tool(srv.url, token, "create_flashcards", { page_id: page, cards });
      assert.equal(full.json.result.isError, true);
      assert.equal(await cardsOf(srv.url, token, page), 0);
      // Le fichier supprimé libère sa place dans le compteur.
      await call(srv.url, "/api/sync", {
        token,
        body: { since: 0, changes: [{ tbl: "files", id: file, at: Date.now(), data: null }] },
      });
      const ok = await tool(srv.url, token, "create_flashcards", { page_id: page, cards });
      assert.match(ok.json.result.content[0].text, /"created": 200/);
    } finally {
      await srv.stop();
    }
  });

  it("recalcule l'espace d'un compte existant à la mise à jour", async () => {
    const file = join(tempDir(), "quota.db");
    let srv = await start({ REGISTRATION: "open", MAX_USER_MB: "1" }, file);
    const token = await register(srv.url, "ancien-quota");
    await call(srv.url, "/api/sync", {
      token,
      body: {
        since: 0,
        changes: [fileRow("eeeeeeee-0000-4000-8000-000000000002", "image/png", Buffer.alloc(600_000, 1))],
      },
    });
    await srv.stop();
    // Base d'avant le compteur : la table est absente.
    const old = new DatabaseSync(file);
    old.exec("DROP TABLE user_usage");
    old.close();
    for (let run = 0; run < 2; run++) {
      srv = await start({ REGISTRATION: "open", MAX_USER_MB: "1" }, file);
      try {
        const more = await call(srv.url, "/api/sync", {
          token,
          body: {
            since: 0,
            changes: [fileRow(`eeeeeeee-0000-4000-8000-00000000010${run}`, "image/png", Buffer.alloc(300_000, 1))],
          },
        });
        assert.equal(more.status, 413);
      } finally {
        await srv.stop();
      }
    }
  });

  it("plafonne la mémoire des pages partagées ouvertes par un compte", async () => {
    const srv = await start({ REGISTRATION: "open", MAX_OPEN_SHARES_MB: "1" });
    try {
      const token = await register(srv.url, "salles");
      const big = () => textUpdate("y".repeat(450_000));
      const { json: a } = await call(srv.url, "/api/share", { token, body: { title: "A", ydoc: big() } });
      const { json: b } = await call(srv.url, "/api/share", { token, body: { title: "B", ydoc: big() } });
      const first = openStream(srv.url, a.id, token);
      await first.ready;
      assert.equal(first.status, 200);
      const second = openStream(srv.url, b.id, token);
      await second.ready;
      assert.equal(second.status, 429);
      first.close();
    } finally {
      await srv.stop();
    }
  });

  it("initialise les fichiers des pages partagées existantes avec ceux du propriétaire", async () => {
    const file = join(tempDir(), "partages.db");
    let srv = await start({ REGISTRATION: "open" }, file);
    const owner = await register(srv.url, "mig-proprio");
    const member = await register(srv.url, "mig-membre");
    const ownerFile = "ffffffff-0000-4000-8000-000000000001";
    const memberFile = "ffffffff-0000-4000-8000-000000000002";
    await call(srv.url, "/api/sync", {
      token: owner,
      body: { since: 0, changes: [fileRow(ownerFile, "image/png", "A")] },
    });
    await call(srv.url, "/api/sync", {
      token: member,
      body: { since: 0, changes: [fileRow(memberFile, "image/png", "B")] },
    });
    const { json: share } = await call(srv.url, "/api/share", { token: owner, body: { title: "T", ydoc: null } });
    await call(srv.url, `/api/share/${share.id}`, { token: member, body: {} });
    await call(srv.url, `/api/share/${share.id}/update`, {
      token: member,
      body: { update: docCiting(ownerFile, memberFile) },
    });
    await wait(3500); // enregistrement de la salle (le serveur est tué sans signal sous Windows)
    await srv.stop();
    // Base d'avant share_files.
    const old = new DatabaseSync(file);
    old.exec("DROP TABLE share_files; DELETE FROM meta");
    old.close();
    for (let run = 0; run < 2; run++) {
      srv = await start({ REGISTRATION: "open" }, file);
      try {
        const get = (id) => call(srv.url, `/api/share/${share.id}/file/${id}`, { method: "GET", token: member });
        assert.equal((await get(ownerFile)).status, 200);
        if (run === 0) {
          assert.equal((await get(memberFile)).status, 404);
          // À sa prochaine modification, les fichiers du participant déjà cités sont relevés.
          await call(srv.url, `/api/share/${share.id}/update`, { token: member, body: { update: textUpdate("z") } });
        }
        assert.equal((await get(memberFile)).status, 200);
      } finally {
        await srv.stop();
      }
    }
  });
});
