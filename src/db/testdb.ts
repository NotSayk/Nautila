/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./schema";
import type { Db, SqlValue } from "./types";

/** Base SQLite en mémoire pour les tests, avec la même transaction `batch` que le worker web. */
export function memoryDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  return {
    raw,
    persistent: false,
    run: async (sql, params = []) => void raw.prepare(sql).run(...params),
    all: async <T>(sql: string, params: SqlValue[] = []) => raw.prepare(sql).all(...params) as T[],
    batch: async (statements) => {
      raw.exec("BEGIN");
      try {
        for (const s of statements) raw.prepare(s.sql).run(...(s.params ?? []));
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** Base en mémoire migrée, branchée comme base de l'application (`db()`). */
export async function migratedDb() {
  const { setDb } = await import("./index");
  const db = memoryDb();
  await migrate(db);
  setDb(db);
  return db;
}
