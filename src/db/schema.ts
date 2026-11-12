import type { Db } from "./types";

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
];

export async function migrate(db: Db): Promise<void> {
  const [{ user_version }] = await db.all<{ user_version: number }>("PRAGMA user_version");
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    for (const sql of MIGRATIONS[v]) await db.run(sql);
    await db.run(`PRAGMA user_version = ${v + 1}`);
  }
}
