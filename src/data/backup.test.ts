import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { BACKUP_TABLES, exportBackup, importBackup } from "./backup";
import { searchPages } from "./pages";

type Db = Awaited<ReturnType<typeof migratedDb>>;
let db: Db;

const NOW = 1_700_000_000_000;

/** Contenu d'une table, trié, pour comparer deux bases. */
const dump = (d: Db, table: string) => d.all(`SELECT * FROM ${table} ORDER BY 1, 2`);

async function seed(d: Db) {
  await d.run(
    "INSERT INTO pages (id, parent_id, title, body, ydoc, position, created_at, updated_at) VALUES ('p1', NULL, 'Analyse', 'limites et suites', 'AAAA', 1, ?, ?)",
    [NOW, NOW],
  );
  await d.run(
    "INSERT INTO pages (id, parent_id, title, body, position, created_at, updated_at, deleted_at) VALUES ('p2', 'p1', 'Corbeille', 'secret', 2, ?, ?, ?)",
    [NOW, NOW, NOW],
  );
  await d.run("INSERT INTO links (source_id, target_id) VALUES ('p1', 'p2')");
  await d.run("INSERT INTO tasks (id, title, created_at) VALUES ('t1', 'Devoir', ?)", [NOW]);
  await d.run(
    "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES ('p1:b', 'p1', 'q', 'r', '{}', 0, ?)",
    [NOW],
  );
  await d.run("INSERT INTO files (id, name, mime, data, created_at) VALUES ('f1', 'a.png', 'image/png', 'QUJD', ?)", [
    NOW,
  ]);
  await d.run("INSERT INTO page_files (page_id, file_id) VALUES ('p1', 'f1')");
  await d.run("INSERT INTO quizzes (id, page_id, title, questions, created_at) VALUES ('q1', 'p1', 'Quiz', '[]', ?)", [
    NOW,
  ]);
  await d.run("INSERT INTO refs (key, title, bibtex, created_at) VALUES ('knuth84', 'TeXbook', '@book{knuth84}', ?)", [
    NOW,
  ]);
  await d.run("INSERT INTO versions (id, page_id, ydoc, body, created_at) VALUES ('v1', 'p1', 'AAAA', 'x', ?)", [NOW]);
  await d.run("INSERT INTO events (id, calendar, title, start, end) VALUES ('e1', 'EDT', 'Cours', ?, ?)", [
    NOW,
    NOW + 3_600_000,
  ]);
  await d.run("INSERT INTO pages_fts (page_id, title, body) VALUES ('p1', 'Analyse', 'limites et suites')");
}

beforeEach(async () => {
  db = await migratedDb();
});

describe("sauvegarde", () => {
  it("couvre toutes les tables de données du schéma", async () => {
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
      (t) => t.name,
    );
    const ignored = (name: string) =>
      name.startsWith("sqlite_") || name.startsWith("pages_fts") || name === "sync_log" || name === "sync_state";
    const missing = tables.filter((t) => !ignored(t) && !(BACKUP_TABLES as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });

  it("aller-retour : exporter puis importer dans une base vide redonne les mêmes données", async () => {
    await seed(db);
    const json = await exportBackup();
    expect(Object.keys(JSON.parse(json).tables)).toEqual(expect.arrayContaining(["quizzes", "refs"]));

    const other = await migratedDb();
    await importBackup(json);
    for (const table of BACKUP_TABLES) expect(await dump(other, table)).toEqual(await dump(db, table));
    expect(await other.all("SELECT id FROM quizzes")).toEqual([{ id: "q1" }]);
    expect(await other.all("SELECT key FROM refs")).toEqual([{ key: "knuth84" }]);
  });

  it("reconstruit l'index de recherche, sans les pages de la corbeille", async () => {
    await seed(db);
    const json = await exportBackup();
    await db.run("DELETE FROM pages_fts");
    await importBackup(json);
    expect((await searchPages("limites")).map((h) => h.id)).toEqual(["p1"]);
    expect(await searchPages("secret")).toEqual([]);
  });

  it("remplace les données existantes", async () => {
    await seed(db);
    const json = await exportBackup();
    await db.run("INSERT INTO tasks (id, title, created_at) VALUES ('t2', 'Ajouté après', 0)");
    await importBackup(json);
    expect(await db.all("SELECT id FROM tasks")).toEqual([{ id: "t1" }]);
  });

  it("accepte une ancienne sauvegarde sans quizzes ni refs, qui restent en place", async () => {
    await seed(db);
    const old = JSON.parse(await exportBackup());
    delete old.tables.quizzes;
    delete old.tables.refs;
    await db.run("DELETE FROM tasks");
    await importBackup(JSON.stringify(old));
    expect(await db.all("SELECT id FROM tasks")).toEqual([{ id: "t1" }]);
    expect(await db.all("SELECT id FROM quizzes")).toEqual([{ id: "q1" }]);
    expect(await db.all("SELECT key FROM refs")).toEqual([{ key: "knuth84" }]);
  });

  it("ignore les colonnes inconnues du schéma courant", async () => {
    await seed(db);
    const backup = JSON.parse(await exportBackup());
    backup.tables.tasks[0].colonne_future = "x";
    backup.tables.pages[0].autre = 3;
    await importBackup(JSON.stringify(backup));
    expect(await db.all("SELECT id, title FROM tasks")).toEqual([{ id: "t1", title: "Devoir" }]);
  });

  describe("sauvegarde invalide : les données existantes sont intactes", () => {
    const cases: [string, (b: Record<string, any>) => unknown][] = [
      ["JSON illisible", () => "{pas du json"],
      ["autre application", (b) => ({ ...b, app: "autre" })],
      ["version inconnue", (b) => ({ ...b, version: 2 })],
      ["tables absentes", (b) => ({ ...b, tables: undefined })],
      ["tables en tableau", (b) => ({ ...b, tables: [] })],
      ["table qui n'est pas une liste", (b) => ({ ...b, tables: { ...b.tables, tasks: "x" } })],
      ["ligne qui n'est pas un objet", (b) => ({ ...b, tables: { ...b.tables, tasks: [3] } })],
      ["colonne obligatoire absente", (b) => ({ ...b, tables: { ...b.tables, pages: [{ id: "z" }] } })],
      [
        "valeur nulle dans une colonne obligatoire",
        (b) => ({ ...b, tables: { ...b.tables, tasks: [{ id: "z", title: null, created_at: 1 }] } }),
      ],
      [
        "valeur de type inattendu",
        (b) => ({ ...b, tables: { ...b.tables, tasks: [{ id: "z", title: { a: 1 }, created_at: 1 }] } }),
      ],
      ["aucune table connue", () => ({ app: "nautila", version: 1, tables: { inconnue: [] } })],
    ];

    for (const [name, damage] of cases)
      it(name, async () => {
        await seed(db);
        const before = await Promise.all(BACKUP_TABLES.map((t) => dump(db, t)));
        const json = await exportBackup();
        const damaged = damage(JSON.parse(json));
        await expect(importBackup(typeof damaged === "string" ? damaged : JSON.stringify(damaged))).rejects.toThrow(
          /invalid backup/,
        );
        expect(await Promise.all(BACKUP_TABLES.map((t) => dump(db, t)))).toEqual(before);
      });

    it("erreur en cours de restauration : retour arrière complet (clé en double)", async () => {
      await seed(db);
      const before = await Promise.all(BACKUP_TABLES.map((t) => dump(db, t)));
      const backup = JSON.parse(await exportBackup());
      // Passe la validation, mais échoue à l'insertion : la suppression déjà faite doit être annulée.
      backup.tables.tasks.push({ ...backup.tables.tasks[0] });
      await expect(importBackup(JSON.stringify(backup))).rejects.toThrow();
      expect(await Promise.all(BACKUP_TABLES.map((t) => dump(db, t)))).toEqual(before);
      expect(await db.all("SELECT page_id FROM pages_fts")).toEqual([{ page_id: "p1" }]);
    });
  });
});
