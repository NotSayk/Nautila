import { db } from "../db";
import { deletePageForever, listTrash } from "./pages";

/** Délai au-delà duquel une page restée dans la corbeille est supprimée définitivement. */
export const TRASH_DAYS = 30;

/** Supprime définitivement toutes les pages de la corbeille ; renvoie le nombre de pages racines traitées. */
export async function emptyTrash(): Promise<number> {
  const items = await listTrash();
  const ids = new Set(items.map((p) => p.id));
  const roots = items.filter((p) => !p.parent_id || !ids.has(p.parent_id));
  for (const p of roots) await deletePageForever(p.id);
  return roots.length;
}

/**
 * Purge les pages supprimées depuis plus de `TRASH_DAYS` jours. Une page n'est retirée que si toute
 * sa descendance est elle aussi dans la corbeille depuis assez longtemps.
 */
export async function purgeOldTrash(now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_DAYS * 86_400_000;
  const old = (await listTrash()).filter((p) => p.deleted_at !== null && p.deleted_at < cutoff);
  const oldIds = new Set(old.map((p) => p.id));
  let purged = 0;
  for (const p of old) {
    if (p.parent_id && oldIds.has(p.parent_id)) continue; // déjà couverte par son parent
    const [fresh] = await db().all<{ n: number }>(
      `WITH RECURSIVE tree(id) AS (
         SELECT ? UNION ALL SELECT c.id FROM pages c JOIN tree t ON c.parent_id = t.id
       ) SELECT COUNT(*) AS n FROM pages WHERE id IN (SELECT id FROM tree) AND (deleted_at IS NULL OR deleted_at >= ?)`,
      [p.id, cutoff],
    );
    if (fresh?.n) continue;
    await deletePageForever(p.id);
    purged++;
  }
  return purged;
}
