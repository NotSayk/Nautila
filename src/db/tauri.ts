import type { Db, SqlValue } from "./types";

export async function openTauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const { invoke } = await import("@tauri-apps/api/core");
  // Le greffon SQL ouvre la base (et son pool) ; les requêtes passent par les commandes de
  // src-tauri/src/lib.rs, qui refusent ATTACH, VACUUM INTO, load_extension et les PRAGMA inutiles :
  // la fenêtre n'a plus le droit d'exécuter du SQL libre (sql:allow-select / sql:allow-execute).
  await Database.load("sqlite:nautila.db");
  const rows = (s: { sql: string; params?: SqlValue[] }) => ({ sql: s.sql, params: s.params ?? [] });
  return {
    persistent: true,
    run: async (sql, params = []) => void (await invoke("db_execute", rows({ sql, params }))),
    all: <T>(sql: string, params: SqlValue[] = []) => invoke<T[]>("db_select", rows({ sql, params })),
    // Le greffon SQL a un pool de connexions : des appels séparés (BEGIN, requêtes, COMMIT) peuvent
    // atterrir sur des connexions différentes. La transaction est donc faite côté Rust, sur une seule
    // connexion du pool (commande `db_transaction`).
    batch: async (statements) => {
      if (statements.length === 0) return;
      await invoke("db_transaction", { statements: statements.map(rows) });
    },
  };
}
