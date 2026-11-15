// Outils communs aux tests du serveur : serveur lancé sur une base temporaire, requêtes HTTP brutes.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import * as Y from "yjs";

const SERVER = new URL("../index.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dirs = [];
export const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "nautila-test-"));
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Lance le serveur et attend qu'il écoute ; renvoie son adresse. */
export function start(env = {}, dataFile = join(tempDir(), "test.db")) {
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
          port: Number(port),
          stop: () => new Promise((r) => (proc.on("exit", r), proc.kill())),
          logs: () => out + err,
        });
    });
    proc.on("exit", (code) => reject(new Error(`serveur arrêté (${code}) : ${out}${err}`)));
  });
}

/** Requête HTTP brute : renvoie statut, en-têtes et corps (JSON si possible). */
export function call(base, path, { method = "POST", body, token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    // Chemin passé tel quel (une adresse complète serait normalisée : `\` → `/`, `..` résolu).
    const { hostname, port } = new URL(base);
    const req = request(
      {
        hostname,
        port,
        path,
        method,
        headers: {
          ...(data !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {}),
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

/** Flux d'une page partagée : trames reçues, statut, fin du flux. */
export function openStream(base, shareId, token) {
  const frames = [];
  const stream = { frames, status: undefined, ended: false };
  stream.ready = new Promise((resolve) => {
    const req = request(
      `${base}/api/share/${shareId}/stream`,
      { headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        stream.status = res.statusCode;
        res.setEncoding("utf8");
        let buffer = "";
        res.on("data", (d) => {
          buffer += d;
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const part = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (part.startsWith("data: ")) frames.push(JSON.parse(part.slice(6)));
          }
          if (frames.length > 0) resolve();
        });
        const end = () => (stream.ended = true);
        res.on("end", end);
        res.on("close", end);
        res.on("error", end);
        if (res.statusCode !== 200) resolve();
      },
    );
    req.on("error", () => ((stream.ended = true), resolve()));
    req.end();
    stream.close = () => req.destroy();
  });
  return stream;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Attend qu'une condition devienne vraie (au plus `ms`). */
export async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await wait(25);
  }
  return false;
}

export const PASSWORD = "correct-horse-battery";
export const fileRow = (id, mime, content, name = "f") => ({
  tbl: "files",
  id,
  at: Date.now(),
  data: { id, name, mime, data: Buffer.from(content).toString("base64"), created_at: 1 },
});

/** Mise à jour Yjs (base64) d'un document qui cite ces fichiers dans des images. */
export function docCiting(...fileIds) {
  const doc = new Y.Doc();
  for (const id of fileIds) {
    const el = new Y.XmlElement("image");
    el.setAttribute("url", `nautila-file:${id}`);
    doc.getXmlFragment("doc").push([el]);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}
