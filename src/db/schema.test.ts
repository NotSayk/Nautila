import { describe, expect, it } from "vitest";
import { migrate } from "./schema";
import { memoryDb } from "./testdb";

describe("migrations", () => {
  it("créent le schéma complet sur une base vide", async () => {
    const db = memoryDb();
    await migrate(db);
    const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(11);
    await db.run("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('p', 'Titre', 1, 1)");
    expect(await db.all("SELECT tbl, id FROM sync_log")).toEqual([{ tbl: "pages", id: "p" }]);
  });

  it("retirent la table des notes et ses déclencheurs", async () => {
    const db = memoryDb();
    await migrate(db);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name = 'grades' OR name LIKE 'sync_grades_%'")).toEqual(
      [],
    );
    await db.run("PRAGMA user_version = 9");
    await migrate(db);
  });

  it("reprennent après une migration interrompue avant sa fin", async () => {
    const db = memoryDb();
    await migrate(db);
    await db.run(
      "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES ('p:b', 'p', 'q', 'r', '{}', 0, 0)",
    );
    // Tout est appliqué, mais le numéro de version n'a pas été enregistré.
    await db.run("PRAGMA user_version = 2");
    await migrate(db);
    const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(11);
    expect(await db.all("SELECT id FROM cards")).toEqual([{ id: "p:b" }]);
    expect(await db.all("SELECT COUNT(*) AS n FROM sync_state")).toEqual([{ n: 1 }]);
  });

  it("annulent une migration qui échoue en route : la version n'avance pas, rien n'est resté à moitié fait", async () => {
    const db = memoryDb();
    await migrate(db);
    await db.run("PRAGMA user_version = 10");
    await db.run("DROP INDEX pages_deleted");
    // La dernière instruction de la migration échoue (« no such table »), les premières ont réussi.
    await db.run("DROP TABLE page_files");
    await expect(migrate(db)).rejects.toThrow();
    const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(10);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name = 'pages_deleted'")).toEqual([]);
  });

  it("ajoutent les index et reprennent une base laissée à moitié migrée", async () => {
    const db = memoryDb();
    await migrate(db);
    await db.run("PRAGMA user_version = 10");
    await migrate(db);
    const names = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(["events_calendar", "pages_deleted", "pages_parent_deleted", "cards_page"]),
    );
  });
});
