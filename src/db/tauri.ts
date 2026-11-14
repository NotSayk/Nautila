import type { Db, SqlValue } from "./types";

export async function openTauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const { invoke } = await import("@tauri-apps/api/core");
  const db = await Database.load("sqlite:nautila.db");
  return {
    persistent: true,
    run: async (sql, params = []) => void (await db.execute(sql, params)),
    all: <T>(sql: string, params: SqlValue[] = []) => db.select<T[]>(sql, params),
    // Le greffon SQL a un pool de connexions : des appels séparés (BEGIN, requêtes, COMMIT) peuvent
    // atterrir sur des connexions différentes. La transaction est donc faite côté Rust, sur une seule
    // connexion du pool (commande `db_transaction`, src-tauri/src/lib.rs).
    batch: async (statements) => {
      if (statements.length === 0) return;
      await invoke("db_transaction", {
        statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      });
    },
  };
}
