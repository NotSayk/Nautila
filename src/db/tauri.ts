import type { Db, SqlValue } from "./types";

export async function openTauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:nautila.db");
  return {
    persistent: true,
    run: async (sql, params = []) => void (await db.execute(sql, params)),
    all: <T>(sql: string, params: SqlValue[] = []) => db.select<T[]>(sql, params),
    // Le greffon SQL n'expose pas de transaction : les instructions se suivent.
    batch: async (statements) => {
      for (const s of statements) await db.execute(s.sql, s.params ?? []);
    },
  };
}
