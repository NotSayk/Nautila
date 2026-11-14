import type { Db } from "./types";

/** Tables synchronisées et expression SQL de leur identifiant (voir src/sync). */
export const SYNC_TABLES: Record<string, string[]> = {
  pages: ["id"],
  tasks: ["id"],
  cards: ["id"],
  files: ["id"],
  databases: ["page_id"],
  slots: ["id"],
  grades: ["id"],
  templates: ["id"],
  links: ["source_id", "target_id"],
  page_files: ["page_id", "file_id"],
  quizzes: ["id"],
  refs: ["key"],
  events: ["id"],
};

/** Chaque écriture locale note la ligne dans sync_log, sauf pendant l'application de changements distants. */
function syncTriggers(tables: string[]): string[] {
  const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
  return tables.flatMap((table) =>
    (["INSERT", "UPDATE", "DELETE"] as const).map((op) => {
      const row = op === "DELETE" ? "OLD" : "NEW";
      const id = SYNC_TABLES[table].map((k) => `${row}.${k}`).join(" || '|' || ");
      return `CREATE TRIGGER sync_${table}_${op.toLowerCase()} AFTER ${op} ON ${table}
        WHEN (SELECT applying FROM sync_state) = 0
        BEGIN
          INSERT INTO sync_log (tbl, id, at) VALUES ('${table}', ${id}, ${now})
            ON CONFLICT (tbl, id) DO UPDATE SET at = excluded.at;
        END`;
    }),
  );
}

/** Chaque entrée fait passer la base à la version suivante (PRAGMA user_version). */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE pages (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      position REAL NOT NULL DEFAULT 0,
      ydoc TEXT,
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )`,
    `CREATE INDEX pages_parent ON pages(parent_id)`,
    `CREATE VIRTUAL TABLE pages_fts USING fts5(
      page_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2'
    )`,
    `CREATE TABLE links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    )`,
    `CREATE INDEX links_target ON links(target_id)`,
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'homework',
      course_id TEXT,
      due_at INTEGER,
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      fsrs TEXT NOT NULL,
      due INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX cards_due ON cards(due)`,
    `CREATE INDEX cards_page ON cards(page_id)`,
  ],
  [
    `ALTER TABLE pages ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE pages ADD COLUMN full_width INTEGER NOT NULL DEFAULT 0`,
  ],
  [
    // L'identifiant d'une carte inclut sa page : une page dupliquée a ses propres cartes.
    `UPDATE cards SET id = page_id || ':' || id WHERE id NOT LIKE page_id || ':%'`,
    `ALTER TABLE pages ADD COLUMN cover TEXT`,
    `ALTER TABLE pages ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE pages ADD COLUMN font TEXT NOT NULL DEFAULT 'sans'`,
    `ALTER TABLE pages ADD COLUMN small_text INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ],
  [
    // Bases de données : la configuration est sur la page « database »,
    // et chaque ligne est une page enfant dont `props` porte les valeurs.
    `CREATE TABLE databases (page_id TEXT PRIMARY KEY, config TEXT NOT NULL)`,
    `ALTER TABLE pages ADD COLUMN props TEXT`,
  ],
  [
    `CREATE TABLE slots (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      title TEXT NOT NULL,
      day INTEGER NOT NULL,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      room TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE grades (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      score REAL NOT NULL,
      out_of REAL NOT NULL DEFAULT 20,
      weight REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      ydoc TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX versions_page ON versions(page_id, created_at)`,
    `CREATE TABLE templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, ydoc TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  ],
  [
    // Quels fichiers une page (ou un modèle) utilise : sert à supprimer les
    // fichiers devenus orphelins. Les fichiers déjà présents sont conservés.
    `CREATE TABLE page_files (page_id TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY (page_id, file_id))`,
    `INSERT OR IGNORE INTO page_files (page_id, file_id) SELECT 'legacy', id FROM files`,
    // Synchronisation : journal des lignes modifiées localement, alimenté par
    // des déclencheurs, et état de la connexion au serveur.
    `CREATE TABLE sync_log (tbl TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (tbl, id))`,
    `CREATE TABLE sync_state (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      applying INTEGER NOT NULL DEFAULT 0,
      server TEXT,
      username TEXT,
      token TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      last_sync INTEGER
    )`,
    `INSERT OR IGNORE INTO sync_state (one) VALUES (1)`,
    ...syncTriggers([
      "pages",
      "tasks",
      "cards",
      "files",
      "databases",
      "slots",
      "grades",
      "templates",
      "links",
      "page_files",
    ]),
  ],
  [
    // Page partagée en direct (identifiant de la salle sur le serveur) et
    // contenu Markdown en attente de mise en forme (page créée hors de l'application).
    `ALTER TABLE pages ADD COLUMN share_id TEXT`,
    `ALTER TABLE pages ADD COLUMN import_md TEXT`,
    `CREATE TABLE quizzes (
      id TEXT PRIMARY KEY,
      page_id TEXT,
      title TEXT NOT NULL,
      questions TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    ...syncTriggers(["quizzes"]),
  ],
  [
    // Étiquettes d'une page (tableau JSON) et références bibliographiques (BibTeX).
    `ALTER TABLE pages ADD COLUMN tags TEXT`,
    `CREATE TABLE refs (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      bibtex TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    ...syncTriggers(["refs"]),
  ],
  [
    // Séances datées d'un calendrier importé (.ics). `calendar` regroupe les séances
    // d'un même fichier : le réimporter met à jour ce calendrier. Heures en millisecondes.
    `CREATE TABLE events (
      id TEXT PRIMARY KEY,
      calendar TEXT NOT NULL,
      title TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      room TEXT NOT NULL DEFAULT '',
      teacher TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      cancelled INTEGER NOT NULL DEFAULT 0,
      course_id TEXT
    )`,
    `CREATE INDEX events_start ON events (start)`,
    ...syncTriggers(["events"]),
  ],
  [
    // --- Fiabilité des données : index des requêtes courantes (rejouable : IF NOT EXISTS). ---
    // Séances d'un calendrier importé (réimport), pages filtrées par corbeille / parent, cartes d'une
    // page, et fichiers cités par une page (nettoyage des fichiers orphelins).
    `CREATE INDEX IF NOT EXISTS events_calendar ON events (calendar)`,
    `CREATE INDEX IF NOT EXISTS pages_deleted ON pages (deleted_at)`,
    `CREATE INDEX IF NOT EXISTS pages_parent_deleted ON pages (parent_id, deleted_at)`,
    `CREATE INDEX IF NOT EXISTS cards_page ON cards (page_id)`,
    `CREATE INDEX IF NOT EXISTS page_files_file ON page_files (file_id)`,
  ],
];

/** Erreurs d'une migration déjà (en partie) appliquée par une ancienne version de l'application. */
const alreadyApplied = (err: unknown) =>
  /duplicate column name|already exists/i.test(String(err instanceof Error ? err.message : err));

/**
 * Applique les migrations manquantes. Chacune est une transaction : ses instructions et le nouveau
 * numéro de version sont validés ensemble, donc une fermeture ou une erreur en cours de route ne
 * laisse jamais la base à moitié migrée.
 * Repli : une base laissée à moitié migrée par une ancienne version (instructions appliquées une
 * à une) fait échouer la transaction sur « existe déjà » ; la migration est alors rejouée
 * instruction par instruction en ignorant ce qui existe déjà.
 */
export async function migrate(db: Db): Promise<void> {
  const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    const bump = `PRAGMA user_version = ${v + 1}`;
    try {
      await db.batch([...MIGRATIONS[v].map((sql) => ({ sql })), { sql: bump }]);
    } catch (err) {
      if (!alreadyApplied(err)) throw err;
      for (const sql of MIGRATIONS[v]) {
        try {
          await db.run(sql);
        } catch (e) {
          if (!alreadyApplied(e)) throw e;
        }
      }
      await db.run(bump);
    }
  }
}
