import * as Y from "yjs";
import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { toBase64 } from "../util/base64";
import { collectFiles } from "./files";

type Db = Awaited<ReturnType<typeof migratedDb>>;
let db: Db;

const DAY = 24 * 3_600_000;
const NOW = Date.UTC(2026, 5, 15);

async function addFile(id: string, ageDays: number) {
  await db.run("INSERT INTO files (id, name, mime, data, created_at) VALUES (?, 'f', 'image/png', '', ?)", [
    id,
    NOW - ageDays * DAY,
  ]);
}
const addPage = (id: string, extra: Record<string, string | null> = {}) =>
  db.run(`INSERT INTO pages (id, title, created_at, updated_at, ydoc, import_md, cover) VALUES (?, ?, 0, 0, ?, ?, ?)`, [
    id,
    id,
    extra.ydoc ?? null,
    extra.import_md ?? null,
    extra.cover ?? null,
  ]);
const fileIds = async () => (await db.all<{ id: string }>("SELECT id FROM files ORDER BY id")).map((f) => f.id);

/** Un document Yjs avec un bloc image, comme celui de l'éditeur. */
function ydocWithImage(fileId: string) {
  const doc = new Y.Doc();
  const block = new Y.XmlElement("image");
  block.setAttribute("url", `nautila-file:${fileId}`);
  doc.getXmlFragment("doc").insert(0, [block]);
  return toBase64(Y.encodeStateAsUpdate(doc));
}

beforeEach(async () => {
  db = await migratedDb();
});

describe("collectFiles", () => {
  it("supprime un ancien fichier que rien n'utilise", async () => {
    await addFile("orphelin", 10);
    await collectFiles(NOW);
    expect(await fileIds()).toEqual([]);
  });

  it("épargne les fichiers récents, même sans lien (délai de grâce de plusieurs jours)", async () => {
    await addFile("hier", 1);
    await addFile("avant-hier", 2);
    await collectFiles(NOW);
    expect(await fileIds()).toEqual(["avant-hier", "hier"]);
  });

  it("épargne les fichiers liés à une page", async () => {
    await addFile("lie", 30);
    await db.run("INSERT INTO page_files (page_id, file_id) VALUES ('p', 'lie')");
    await collectFiles(NOW);
    expect(await fileIds()).toEqual(["lie"]);
  });

  it("épargne les fichiers cités par un contenu importé jamais ouvert, et rétablit le lien", async () => {
    await addFile("image", 30);
    await addFile("pdf", 30);
    await addFile("couverture", 30);
    await addPage("md", { import_md: "# Titre\n\n![](nautila-file:image)" });
    await addPage("pdfpage", { import_md: '<!--blocks-->[{"type":"pdf","props":{"url":"nautila-file:pdf"}}]' });
    await addPage("cov", { cover: "nautila-file:couverture" });
    await collectFiles(NOW);
    expect(await fileIds()).toEqual(["couverture", "image", "pdf"]);
    expect(await db.all("SELECT page_id, file_id FROM page_files ORDER BY file_id")).toEqual([
      { page_id: "cov", file_id: "couverture" },
      { page_id: "md", file_id: "image" },
      { page_id: "pdfpage", file_id: "pdf" },
    ]);
  });

  it("épargne un fichier cité par le document d'une page ou d'un modèle, arrivé sans son lien", async () => {
    await addFile("synchro", 30);
    await addFile("modele", 30);
    await addFile("orphelin", 30);
    await addPage("p", { ydoc: ydocWithImage("synchro") });
    await db.run("INSERT INTO templates (id, name, ydoc, created_at) VALUES ('t', 'T', ?, 0)", [
      ydocWithImage("modele"),
    ]);
    await collectFiles(NOW);
    expect(await fileIds()).toEqual(["modele", "synchro"]);
    expect(await db.all("SELECT page_id FROM page_files ORDER BY page_id")).toEqual([
      { page_id: "p" },
      { page_id: "t" },
    ]);
  });

  it("supprime le fichier d'une page dont le document ne le cite plus", async () => {
    await addFile("retiré", 30);
    await addPage("p", { ydoc: ydocWithImage("autre") });
    await collectFiles(NOW);
    expect(await fileIds()).toEqual([]);
  });
});
