import { db } from "../db";
import type { Statement } from "../db/types";

export type Version = { id: string; page_id: string; ydoc: string; body: string; created_at: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Au plus une version toutes les dix minutes (sauf `force`). */
const INTERVAL = 10 * MINUTE;
/** Versions de moins de 3 h : toutes gardées ; jusqu'à 2 jours : une par heure ; jusqu'à 60 jours : une par jour. */
const FINE = 3 * HOUR;
const HOURLY = 2 * DAY;
const DAILY = 60 * DAY;
/** Plafond par page : les plus anciennes partent d'abord. */
const MAX_VERSIONS = 120;

/**
 * Versions à garder parmi `rows` : les récentes finement, puis une par heure, puis une par jour
 * (la plus récente de chaque tranche), dans la limite de MAX_VERSIONS. Renvoie les identifiants à supprimer.
 */
export function versionsToDrop(rows: { id: string; created_at: number }[], now: number): string[] {
  const newestFirst = [...rows].sort((a, b) => b.created_at - a.created_at);
  const buckets = new Set<string>();
  const keep: string[] = [];
  for (const row of newestFirst) {
    const age = now - row.created_at;
    // Parcours du plus récent au plus ancien : la première version d'une tranche est la plus récente.
    const bucket =
      age < FINE
        ? row.id
        : age < HOURLY
          ? `h${Math.floor(row.created_at / HOUR)}`
          : `d${Math.floor(row.created_at / DAY)}`;
    if (age >= DAILY || buckets.has(bucket)) continue;
    buckets.add(bucket);
    keep.push(row.id);
  }
  const kept = new Set(keep.slice(0, MAX_VERSIONS));
  return newestFirst.filter((r) => !kept.has(r.id)).map((r) => r.id);
}

/**
 * Instructions qui conservent une version de la page, au plus une toutes les dix minutes (sauf
 * `force`), et qui amincissent l'historique. Vide si le contenu n'a pas changé.
 */
export async function snapshotStatements(
  pageId: string,
  ydoc: string,
  body: string,
  force = false,
  now = Date.now(),
): Promise<Statement[]> {
  const [last] = await db().all<{ created_at: number; ydoc: string }>(
    "SELECT created_at, ydoc FROM versions WHERE page_id = ? ORDER BY created_at DESC LIMIT 1",
    [pageId],
  );
  if (last && (last.ydoc === ydoc || (!force && now - last.created_at < INTERVAL))) return [];
  const existing = await db().all<{ id: string; created_at: number }>(
    "SELECT id, created_at FROM versions WHERE page_id = ?",
    [pageId],
  );
  const id = crypto.randomUUID();
  const statements: Statement[] = [
    {
      sql: "INSERT INTO versions (id, page_id, ydoc, body, created_at) VALUES (?,?,?,?,?)",
      params: [id, pageId, ydoc, body, now],
    },
  ];
  for (const old of versionsToDrop([...existing, { id, created_at: now }], now))
    statements.push({ sql: "DELETE FROM versions WHERE id = ?", params: [old] });
  return statements;
}

export async function snapshot(pageId: string, ydoc: string, body: string, force = false) {
  const statements = await snapshotStatements(pageId, ydoc, body, force);
  if (statements.length) await db().batch(statements);
}

export const listVersions = (pageId: string) =>
  db().all<Version>("SELECT * FROM versions WHERE page_id = ? ORDER BY created_at DESC", [pageId]);
