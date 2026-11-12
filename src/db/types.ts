export type SqlValue = string | number | null;

/** Interface minimale commune au SQLite du navigateur (WASM) et à celui de Tauri. */
export interface Db {
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** false si les données ne survivront pas à la fermeture (stockage indisponible). */
  readonly persistent: boolean;
}
