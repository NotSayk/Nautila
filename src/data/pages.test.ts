import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { addCard, deckCards } from "./cards";
import { collectFiles } from "./files";
import {
  createPage,
  deletePageForever,
  duplicatePage,
  restorePage,
  savePageContent,
  searchPages,
  trashPage,
  updatePageMeta,
} from "./pages";

type Db = Awaited<ReturnType<typeof migratedDb>>;
let db: Db;

const content = (body: string, cards: { id: string; front: string; back: string }[] = [], links: string[] = []) => ({
  body,
  cards,
  links,
  files: [],
});

beforeEach(async () => {
  db = await migratedDb();
});

describe("duplicatePage", () => {
  it("copie une page avec ses sous-pages, leurs positions et leur contenu", async () => {
    const parent = await createPage({ title: "Cours" });
    const child = await createPage({ title: "Chapitre 1", parentId: parent.id });
    const grandChild = await createPage({ title: "Section", parentId: child.id });
    await db.run("UPDATE pages SET position = 7, body = 'texte' WHERE id = ?", [child.id]);
    await db.run("UPDATE pages SET ydoc = 'AAAA', tags = '[\"x\"]' WHERE id = ?", [grandChild.id]);

    const copy = await duplicatePage(parent.id, " (copie)");
    const rows = await db.all<{ id: string; parent_id: string | null; title: string; position: number }>(
      "SELECT id, parent_id, title, position FROM pages WHERE id != ? AND id != ? AND id != ? ORDER BY title",
      [parent.id, child.id, grandChild.id],
    );
    expect(rows.map((r) => r.title)).toEqual(["Chapitre 1", "Cours (copie)", "Section"]);
    const copyChild = rows.find((r) => r.title === "Chapitre 1")!;
    expect(copyChild.parent_id).toBe(copy);
    expect(copyChild.position).toBe(7);
    expect(rows.find((r) => r.title === "Section")!.parent_id).toBe(copyChild.id);
    expect(await db.all("SELECT ydoc, tags FROM pages WHERE title = 'Section' AND id != ?", [grandChild.id])).toEqual([
      { ydoc: "AAAA", tags: '["x"]' },
    ]);
    // La copie est cherchable.
    expect((await searchPages("Chapitre")).length).toBe(2);
  });

  it("n'emporte pas les sous-pages de la corbeille et garde le contenu d'une page importée jamais ouverte", async () => {
    const page = await createPage({ title: "Import" });
    const gone = await createPage({ title: "Supprimée", parentId: page.id });
    await db.run("UPDATE pages SET import_md = '# Texte en attente', body = 'Texte' WHERE id = ?", [page.id]);
    await trashPage(gone.id);
    const copy = await duplicatePage(page.id, " 2");
    expect(await db.all("SELECT title FROM pages WHERE parent_id = ?", [copy])).toEqual([]);
    expect(await db.all("SELECT import_md FROM pages WHERE id = ?", [copy])).toEqual([
      { import_md: "# Texte en attente" },
    ]);
  });

  it("copie les cartes de blocs et les cartes ajoutées à la main sans les tronquer", async () => {
    const page = await createPage({ title: "Paquet" });
    await savePageContent(page.id, "AAAA", content("b", [{ id: "blk1", front: "q1", back: "r1" }]));
    await addCard(page.id, "q2", "r2");
    await addCard(page.id, "q3", "r3");
    const copy = await duplicatePage(page.id, "'");
    const cards = await deckCards(copy);
    expect(cards.map((c) => [c.front, c.back]).sort()).toEqual([
      ["q1", "r1"],
      ["q2", "r2"],
      ["q3", "r3"],
    ]);
    expect(cards.map((c) => c.id).filter((id) => id.startsWith(`${copy}:`))).toEqual([`${copy}:blk1`]);
    expect(cards.filter((c) => c.id.startsWith("extra:")).length).toBe(2);
    // La source garde ses cartes, avec les mêmes identifiants.
    expect((await deckCards(page.id)).length).toBe(3);
    // Un nouvel enregistrement de la copie ne retire pas les cartes ajoutées à la main.
    await savePageContent(copy, "BBBB", content("b", [{ id: "blk1", front: "q1", back: "r1" }]));
    expect((await deckCards(copy)).length).toBe(3);
  });

  it("annule tout si une instruction échoue", async () => {
    const page = await createPage({ title: "A" });
    const child = await createPage({ title: "B", parentId: page.id });
    // Les deux copies reçoivent le même identifiant : la deuxième insertion échoue, la première est annulée.
    const before = (await db.all("SELECT id FROM pages")).length;
    const original = crypto.randomUUID;
    let calls = 0;
    crypto.randomUUID = (() => (calls++ < 2 ? "dup" : original.call(crypto))) as typeof crypto.randomUUID;
    try {
      await expect(duplicatePage(page.id, "")).rejects.toThrow();
    } finally {
      crypto.randomUUID = original;
    }
    expect((await db.all("SELECT id FROM pages")).length).toBe(before);
    expect(child.id).toBeTruthy();
  });
});

describe("updatePageMeta", () => {
  it("met à jour la date de modification pour toute modification réelle, pas sinon", async () => {
    const page = await createPage({ title: "Titre" });
    await db.run("UPDATE pages SET updated_at = 1 WHERE id = ?", [page.id]);
    const at = async () =>
      (await db.all<{ updated_at: number }>("SELECT updated_at FROM pages WHERE id = ?", [page.id]))[0].updated_at;

    await updatePageMeta(page.id, { favorite: false, title: "Titre" }); // rien ne change
    expect(await at()).toBe(1);
    await updatePageMeta(page.id, {});
    expect(await at()).toBe(1);

    await updatePageMeta(page.id, { favorite: true });
    const afterFavorite = await at();
    expect(afterFavorite).toBeGreaterThan(1);
    await db.run("UPDATE pages SET updated_at = 1 WHERE id = ?", [page.id]);
    await updatePageMeta(page.id, { icon: "📘", locked: true });
    expect(await at()).toBeGreaterThan(1);
    expect(await db.all("SELECT icon, locked, favorite FROM pages WHERE id = ?", [page.id])).toEqual([
      { icon: "📘", locked: 1, favorite: 1 },
    ]);
  });

  it("réindexe le titre modifié", async () => {
    const page = await createPage({ title: "Ancien" });
    await updatePageMeta(page.id, { title: "Nouveau" });
    expect((await searchPages("Nouveau")).map((h) => h.id)).toEqual([page.id]);
    expect(await searchPages("Ancien")).toEqual([]);
  });

  it("lie le fichier de couverture à la page", async () => {
    const page = await createPage({ title: "Couv" });
    await updatePageMeta(page.id, { cover: "nautila-file:abc" });
    expect(await db.all("SELECT file_id FROM page_files WHERE page_id = ?", [page.id])).toEqual([{ file_id: "abc" }]);
  });
});

describe("savePageContent", () => {
  it("n'écrit pas les liens ni les cartes qui n'ont pas changé", async () => {
    const a = await createPage({ title: "A" });
    const b = await createPage({ title: "B" });
    const doc = content("texte", [{ id: "c1", front: "q", back: "r" }], [b.id]);
    await savePageContent(a.id, "AAAA", doc);
    await db.run("DELETE FROM sync_log");

    await savePageContent(a.id, "AAAA", doc);
    // Seule la page elle-même est réécrite : ni carte, ni lien, ni version.
    expect(await db.all("SELECT tbl FROM sync_log")).toEqual([{ tbl: "pages" }]);

    await db.run("DELETE FROM sync_log");
    await savePageContent(a.id, "BBBB", content("texte 2", [{ id: "c1", front: "q2", back: "r" }], [b.id]));
    expect((await db.all<{ tbl: string }>("SELECT tbl FROM sync_log ORDER BY tbl")).map((r) => r.tbl)).toEqual([
      "cards",
      "pages",
    ]);
  });

  it("met à jour les liens et retire les cartes disparues du contenu, pas les cartes ajoutées à la main", async () => {
    const a = await createPage({ title: "A" });
    const b = await createPage({ title: "B" });
    const c = await createPage({ title: "C" });
    await addCard(a.id, "extra q", "extra r");
    await savePageContent(a.id, "1", content("x", [{ id: "c1", front: "q", back: "r" }], [b.id]));
    await savePageContent(a.id, "2", content("x", [], [c.id]));
    expect(await db.all("SELECT target_id FROM links WHERE source_id = ?", [a.id])).toEqual([{ target_id: c.id }]);
    expect((await deckCards(a.id)).map((card) => card.front)).toEqual(["extra q"]);
  });

  it("garde l'index de recherche et le contenu d'une page importée en attente", async () => {
    const page = await createPage({ title: "Import" });
    await db.run("UPDATE pages SET import_md = '# md' WHERE id = ?", [page.id]);
    await savePageContent(page.id, "AAAA", content("photosynthèse"));
    expect(await db.all("SELECT import_md FROM pages WHERE id = ?", [page.id])).toEqual([{ import_md: null }]);
    expect((await searchPages("photosynthese")).map((h) => h.id)).toEqual([page.id]);
  });
});

describe("corbeille", () => {
  it("met à la corbeille, restaure et supprime définitivement toute une branche", async () => {
    const parent = await createPage({ title: "Parent" });
    const child = await createPage({ title: "Enfant", parentId: parent.id });
    await savePageContent(child.id, "AAAA", content("mot", [{ id: "c", front: "q", back: "r" }]));

    await trashPage(parent.id);
    expect(await db.all("SELECT id FROM pages WHERE deleted_at IS NULL")).toEqual([]);
    expect(await searchPages("mot")).toEqual([]);

    await restorePage(parent.id);
    expect((await db.all("SELECT id FROM pages WHERE deleted_at IS NULL")).length).toBe(2);
    expect((await searchPages("mot")).length).toBe(1);

    await trashPage(parent.id);
    await deletePageForever(parent.id);
    for (const table of ["pages", "cards", "versions", "pages_fts"])
      expect(await db.all(`SELECT 1 FROM ${table}`)).toEqual([]);
  });

  it("supprime la page même si la table des notes n'existe plus", async () => {
    const page = await createPage({ title: "Matière", kind: "course" });
    await db.run("DROP TABLE grades");
    await deletePageForever(page.id);
    expect(await db.all("SELECT id FROM pages")).toEqual([]);
  });

  it("retire les fichiers devenus orphelins après la suppression définitive", async () => {
    const page = await createPage({ title: "Avec image" });
    const old = Date.now() - 30 * 24 * 3_600_000;
    await db.run("INSERT INTO files (id, name, mime, data, created_at) VALUES ('f', 'a', 'image/png', '', ?)", [old]);
    await db.run("INSERT INTO page_files (page_id, file_id) VALUES (?, 'f')", [page.id]);
    await collectFiles();
    expect(await db.all("SELECT id FROM files")).toEqual([{ id: "f" }]);
    await deletePageForever(page.id);
    expect(await db.all("SELECT id FROM files")).toEqual([]);
  });
});
