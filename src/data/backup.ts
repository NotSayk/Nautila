import { db } from "../db";
import type { SqlValue } from "../db/types";

const TABLES = ["pages", "links", "tasks", "cards", "files", "databases"] as const;
type Backup = { app: "nautila"; version: 1; exported_at: number; tables: Record<string, Record<string, SqlValue>[]> };

export async function exportBackup(): Promise<string> {
  const tables: Backup["tables"] = {};
  for (const t of TABLES) tables[t] = await db().all(`SELECT * FROM ${t}`);
  const backup: Backup = { app: "nautila", version: 1, exported_at: Date.now(), tables };
  return JSON.stringify(backup);
}

/** Remplace tout le contenu local par celui de la sauvegarde. */
export async function importBackup(json: string): Promise<void> {
  const backup = JSON.parse(json) as Backup;
  if (backup.app !== "nautila" || backup.version !== 1 || !backup.tables) throw new Error("invalid backup");

  for (const t of TABLES) await db().run(`DELETE FROM ${t}`);
  await db().run("DELETE FROM pages_fts");
  for (const t of TABLES) {
    for (const row of backup.tables[t] ?? []) {
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      await db().run(
        `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        cols.map((c) => row[c]),
      );
    }
  }
  await db().run(
    "INSERT INTO pages_fts (page_id, title, body) SELECT id, title, body FROM pages WHERE deleted_at IS NULL",
  );
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
