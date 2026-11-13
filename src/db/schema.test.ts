/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate } from "./schema";
import type { Db, SqlValue } from "./types";

function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  return {
    raw,
    persistent: false,
    run: async (sql, params = []) => void raw.prepare(sql).run(...params),
    all: async <T>(sql: string, params: SqlValue[] = []) => raw.prepare(sql).all(...params) as T[],
    batch: async (statements) => statements.forEach((s) => raw.prepare(s.sql).run(...(s.params ?? []))),
  };
}

describe("migrations", () => {
  it("créent le schéma complet sur une base vide", async () => {
    const db = memoryDb();
    await migrate(db);
    const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(user_version).toBe(8);
    await db.run("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('p', 'Titre', 1, 1)");
    expect(await db.all("SELECT tbl, id FROM sync_log")).toEqual([{ tbl: "pages", id: "p" }]);
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
    expect(user_version).toBe(8);
    expect(await db.all("SELECT id FROM cards")).toEqual([{ id: "p:b" }]);
    expect(await db.all("SELECT COUNT(*) AS n FROM sync_state")).toEqual([{ n: 1 }]);
  });
});
