import { db, isTauri } from "../db";
import type { SqlValue, Statement } from "../db/types";

/**
 * Tables de données de l'utilisateur. Hors sauvegarde : pages_fts (index reconstruit à la
 * restauration), sync_log et sync_state (état de la synchronisation, propre à l'appareil).
 */
export const BACKUP_TABLES = [
  "pages",
  "links",
  "tasks",
  "cards",
  "files",
  "databases",
  "slots",
  "events",
  "templates",
  "versions",
  "page_files",
  "quizzes",
  "refs",
  "review_log",
  "study_log",
] as const;
type Backup = { app: "nautila"; version: 1; exported_at: number; tables: Record<string, Record<string, SqlValue>[]> };

export async function exportBackup(): Promise<string> {
  const tables: Backup["tables"] = {};
  for (const t of BACKUP_TABLES) {
    // Une table retirée du schéma (version plus récente de l'application) est simplement absente.
    if ((await columnsOf(t)).length > 0) tables[t] = await db().all(`SELECT * FROM ${t}`);
  }
  const backup: Backup = { app: "nautila", version: 1, exported_at: Date.now(), tables };
  return JSON.stringify(backup);
}

type Column = { name: string; notnull: number; dflt_value: string | null; pk: number };
const columnsOf = (table: string) => db().all<Column>(`PRAGMA table_info(${table})`);

const invalid = (why: string) => new Error(`invalid backup: ${why}`);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Vérifie toute la sauvegarde sans toucher à la base et prépare les instructions de restauration.
 * Les colonnes inconnues du schéma courant sont ignorées ; les tables absentes de la sauvegarde
 * (sauvegarde ancienne) restent telles quelles dans la base.
 */
async function planRestore(json: string): Promise<Statement[]> {
  let backup: unknown;
  try {
    backup = JSON.parse(json);
  } catch {
    throw invalid("not JSON");
  }
  if (!isRecord(backup) || backup.app !== "nautila" || backup.version !== 1 || !isRecord(backup.tables))
    throw invalid("unknown format");

  const deletes: Statement[] = [];
  const inserts: Statement[] = [];
  let restoresPages = false;
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw invalid(`${table}: not a list`);
    const columns = await columnsOf(table);
    if (columns.length === 0) continue;
    const known = new Set(columns.map((c) => c.name));
    // Colonnes qui refusent null : sans valeur par défaut, toute ligne doit les fournir.
    const notNull = new Set(columns.filter((c) => c.notnull || c.pk).map((c) => c.name));
    const required = columns.filter((c) => (c.notnull || c.pk) && c.dflt_value === null).map((c) => c.name);
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row)) throw invalid(`${table}[${index}]: not an object`);
      const names = Object.keys(row).filter((name) => known.has(name));
      for (const name of names) {
        const value = row[name];
        const ok = value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
        if (!ok) throw invalid(`${table}[${index}].${name}: unsupported value`);
        if (value === null && notNull.has(name)) throw invalid(`${table}[${index}].${name}: null`);
      }
      for (const name of required)
        if (row[name] === undefined || row[name] === null) throw invalid(`${table}[${index}].${name}: missing`);
      if (names.length === 0) throw invalid(`${table}[${index}]: no known column`);
      inserts.push({
        sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        params: names.map((name) => row[name] as SqlValue),
      });
    }
    deletes.push({ sql: `DELETE FROM ${table}` });
    if (table === "pages") restoresPages = true;
  }
  if (deletes.length === 0) throw invalid("no table");

  const rebuild: Statement[] = restoresPages
    ? [
        { sql: "DELETE FROM pages_fts" },
        {
          sql: "INSERT INTO pages_fts (page_id, title, body) SELECT id, title, body FROM pages WHERE deleted_at IS NULL",
        },
      ]
    : [];
  return [...deletes, ...inserts, ...rebuild];
}

/**
 * Remplace le contenu local par celui de la sauvegarde. La sauvegarde est d'abord vérifiée en entier ;
 * la suppression et la réinsertion se font ensuite dans une seule transaction : en cas d'erreur,
 * rien n'est modifié.
 */
export async function importBackup(json: string): Promise<void> {
  await db().batch(await planRestore(json));
}

/** Message affiché en bas d'écran ; l'interface est chargée à la demande (les tests n'en ont pas besoin). */
async function toast(key: "savedTo" | "saveFailed", suffix = "") {
  const [{ translate }, { useStore }] = await Promise.all([import("../i18n"), import("../store")]);
  useStore.setState({ toast: { message: translate(useStore.getState().lang, key) + suffix } });
}

export function download(filename: string, content: string, type: string) {
  if (isTauri()) {
    // Dans la fenêtre de bureau un lien de téléchargement ne fait rien : le fichier est écrit dans Téléchargements.
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("save_download", { name: filename, content }))
      .then(
        (path) => toast("savedTo", ` ${path}`),
        () => toast("saveFailed"),
      );
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
