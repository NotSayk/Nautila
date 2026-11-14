export type SqlValue = string | number | null;

export type Statement = { sql: string; params?: SqlValue[] };

/** Interface minimale commune au SQLite du navigateur (WASM) et à celui de Tauri. */
export interface Db {
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /**
   * Transaction : exécute les instructions à la suite, sur une seule connexion, et les valide
   * ensemble. À la première erreur tout est annulé (retour arrière) et l'erreur est relancée.
   * Aucune autre requête ne s'intercale. Les lectures dont dépendent les écritures se font
   * donc avant l'appel, pour construire la liste d'instructions.
   */
  batch(statements: Statement[]): Promise<void>;
  /** false si les données ne survivront pas à la fermeture (stockage indisponible). */
  readonly persistent: boolean;
  /**
   * true si le stockage durable est indisponible parce que Nautila est déjà ouvert dans un autre
   * onglet (la base est alors en mémoire, sans persistance). Toujours absent sous Tauri.
   */
  readonly blockedByOtherTab?: boolean;
}
