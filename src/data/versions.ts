import { db } from "../db";

export type Version = { id: string; page_id: string; ydoc: string; body: string; created_at: number };

const INTERVAL = 10 * 60_000;
const KEEP = 30;

/** Conserve une version de la page, au plus une toutes les dix minutes (sauf `force`). */
export async function snapshot(pageId: string, ydoc: string, body: string, force = false) {
  const now = Date.now();
  const [last] = await db().all<{ created_at: number; ydoc: string }>(
    "SELECT created_at, ydoc FROM versions WHERE page_id = ? ORDER BY created_at DESC LIMIT 1",
    [pageId],
  );
  if (last && (last.ydoc === ydoc || (!force && now - last.created_at < INTERVAL))) return;
  await db().run("INSERT INTO versions (id, page_id, ydoc, body, created_at) VALUES (?,?,?,?,?)", [
    crypto.randomUUID(),
    pageId,
    ydoc,
    body,
    now,
  ]);
  await db().run(
    `DELETE FROM versions WHERE page_id = ? AND id NOT IN
       (SELECT id FROM versions WHERE page_id = ? ORDER BY created_at DESC LIMIT ${KEEP})`,
    [pageId, pageId],
  );
}

export const listVersions = (pageId: string) =>
  db().all<Version>("SELECT * FROM versions WHERE page_id = ? ORDER BY created_at DESC", [pageId]);
