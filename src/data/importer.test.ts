import { strToU8, zipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { collectFiles } from "./files";
import { importFiles, isTextFile, notionTitle, splitMarkdown } from "./importer";

describe("import", () => {
  it("prend le premier titre comme titre de page", () => {
    expect(splitMarkdown("# Cours 1\n\nTexte", "fichier")).toEqual({ title: "Cours 1", body: "\nTexte" });
    expect(splitMarkdown("Texte sans titre", "fichier")).toEqual({ title: "fichier", body: "Texte sans titre" });
  });

  it("nettoie les noms de fichiers d'un export Notion", () => {
    expect(notionTitle("Semestre 1 0123456789abcdef0123456789abcdef/Analyse fedcba9876543210fedcba9876543210.md")).toBe(
      "Analyse",
    );
    expect(notionTitle("Notes.md")).toBe("Notes");
  });

  it("ne lit comme du texte que le Markdown et le texte brut", () => {
    expect(isTextFile({ name: "notes.md", type: "" })).toBe(true);
    expect(isTextFile({ name: "notes.MARKDOWN", type: "" })).toBe(true);
    expect(isTextFile({ name: "notes.txt", type: "text/plain" })).toBe(true);
    expect(isTextFile({ name: "lisez-moi", type: "text/plain" })).toBe(true);
    expect(isTextFile({ name: "photo.png", type: "image/png" })).toBe(false);
    expect(isTextFile({ name: "archive.exe", type: "application/octet-stream" })).toBe(false);
    expect(isTextFile({ name: "inconnu", type: "" })).toBe(false);
  });
});

// Node n'a pas FileReader (le navigateur oui) : version minimale pour `saveFile`.
beforeAll(() => {
  class TestReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      });
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = TestReader;
});

type Db = Awaited<ReturnType<typeof migratedDb>>;
let db: Db;
beforeEach(async () => {
  db = await migratedDb();
});

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const zipFile = (files: Record<string, string | Uint8Array>, name = "export.zip") =>
  new File(
    [zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])))],
    name,
  );

describe("importFiles", () => {
  it("refuse un fichier qui n'est ni texte ni document connu, sans créer de page", async () => {
    const binary = new File([Uint8Array.from([0, 159, 146, 150])], "programme.exe", {
      type: "application/octet-stream",
    });
    const text = new File(["# Titre\n\ncorps"], "note.md");
    const { open, failed } = await importFiles([binary, text]);
    expect(failed).toEqual(["programme.exe"]);
    expect(await db.all("SELECT title FROM pages")).toEqual([{ title: "Titre" }]);
    expect(open).toBeTruthy();
  });

  it("lie dès l'import les images d'un zip à leur page, et les garde malgré le nettoyage des fichiers", async () => {
    const zip = zipFile({
      "Export/Cours.md": "# Cours\n\n![a](img/a.png)\n![b](./img/b.png)\n![c](../autre/c.png)\n![d](manquante.png)",
      "Export/img/a.png": PNG,
      "Export/img/b.png": PNG,
      "autre/c.png": PNG,
    });
    const { failed } = await importFiles([zip]);
    expect(failed).toEqual([]);
    const [page] = await db.all<{ id: string; import_md: string }>("SELECT id, import_md FROM pages");
    expect(page.import_md.match(/nautila-file:/g)?.length).toBe(3);
    expect(page.import_md).toContain("![d](manquante.png)");
    expect((await db.all("SELECT file_id FROM page_files WHERE page_id = ?", [page.id])).length).toBe(3);

    // Les fichiers ont plus de trois jours et la page n'a jamais été ouverte : ils restent.
    await db.run("UPDATE files SET created_at = 0");
    await collectFiles();
    expect((await db.all("SELECT id FROM files")).length).toBe(3);
  });

  it("garde les deux lignes d'une base Notion qui ont le même titre", async () => {
    const zip = zipFile({
      "Tâches.csv": "Nom,Statut\nDoublon,a\nDoublon,b\nUnique,c\n",
      "Tâches/Doublon aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md": "# Doublon\n\npremier contenu",
      "Tâches/Doublon bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md": "# Doublon\n\nsecond contenu",
      "Tâches/Unique cccccccccccccccccccccccccccccccc.md": "# Unique\n\nautre",
    });
    await importFiles([zip]);
    const rows = await db.all<{ title: string; import_md: string; props: string }>(
      "SELECT title, import_md, props FROM pages WHERE parent_id IS NOT NULL ORDER BY title, import_md",
    );
    expect(rows.map((r) => [r.title, r.import_md.trim()])).toEqual([
      ["Doublon", "premier contenu"],
      ["Doublon", "second contenu"],
      ["Unique", "autre"],
    ]);
    // Chaque ligne garde ses propres valeurs de colonnes.
    expect(
      rows
        .filter((r) => r.title === "Doublon")
        .map((r) => Object.values(JSON.parse(r.props)))
        .sort(),
    ).toEqual([["a"], ["b"]]);
  });

  it("lie le PDF à sa page dès l'import", async () => {
    const pdf = new File([Uint8Array.from([37, 80, 68, 70])], "cours.pdf", { type: "application/pdf" });
    await importFiles([pdf]);
    const [page] = await db.all<{ id: string }>("SELECT id FROM pages");
    expect((await db.all("SELECT file_id FROM page_files WHERE page_id = ?", [page.id])).length).toBe(1);
  });
});
