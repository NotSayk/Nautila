import { db } from "../db";
import { syncCards } from "./cards";
import { toFtsQuery, type Extracted } from "./extract";

export type PageKind = "note" | "course" | "semester";

export type PageMeta = {
  id: string;
  parent_id: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const META = "id, parent_id, kind, title, icon, position, created_at, updated_at, deleted_at";

export const listPages = () =>
  db().all<PageMeta>(`SELECT ${META} FROM pages WHERE deleted_at IS NULL ORDER BY position, created_at`);

export const listTrash = () =>
  db().all<PageMeta>(`SELECT ${META} FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);

export async function getPageDoc(id: string): Promise<string | null> {
  const rows = await db().all<{ ydoc: string | null }>("SELECT ydoc FROM pages WHERE id = ?", [id]);
  return rows[0]?.ydoc ?? null;
}

async function reindex(id: string) {
  await db().run("DELETE FROM pages_fts WHERE page_id = ?", [id]);
  await db().run(
    "INSERT INTO pages_fts (page_id, title, body) SELECT id, title, body FROM pages WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
}

export async function createPage(input: {
  parentId?: string | null;
  kind?: PageKind;
  title?: string;
  icon?: string | null;
}): Promise<PageMeta> {
  const now = Date.now();
  const page: PageMeta = {
    id: crypto.randomUUID(),
    parent_id: input.parentId ?? null,
    kind: input.kind ?? "note",
    title: input.title ?? "",
    icon: input.icon ?? null,
    position: now,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db().run(
    "INSERT INTO pages (id, parent_id, kind, title, icon, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [page.id, page.parent_id, page.kind, page.title, page.icon, page.position, now, now],
  );
  await reindex(page.id);
  return page;
}

export async function updatePageMeta(id: string, patch: { title?: string; icon?: string | null }) {
  if (patch.title !== undefined)
    await db().run("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?", [patch.title, Date.now(), id]);
  if (patch.icon !== undefined) await db().run("UPDATE pages SET icon = ? WHERE id = ?", [patch.icon, id]);
  await reindex(id);
}

export async function savePageContent(id: string, ydoc: string, extracted: Extracted) {
  await db().run("UPDATE pages SET ydoc = ?, body = ?, updated_at = ? WHERE id = ?", [
    ydoc,
    extracted.body,
    Date.now(),
    id,
  ]);
  await reindex(id);
  await db().run("DELETE FROM links WHERE source_id = ?", [id]);
  for (const target of extracted.links)
    await db().run("INSERT OR IGNORE INTO links (source_id, target_id) VALUES (?, ?)", [id, target]);
  await syncCards(id, extracted.cards);
}

/** Identifiants de la page et de toute sa descendance. */
async function subtree(id: string): Promise<string[]> {
  const rows = await db().all<{ id: string }>(
    `WITH RECURSIVE tree(id) AS (
       SELECT ? UNION ALL SELECT p.id FROM pages p JOIN tree t ON p.parent_id = t.id
     ) SELECT id FROM tree`,
    [id],
  );
  return rows.map((r) => r.id);
}

export async function trashPage(id: string) {
  const now = Date.now();
  for (const pid of await subtree(id)) {
    await db().run("UPDATE pages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", [now, pid]);
    await db().run("DELETE FROM pages_fts WHERE page_id = ?", [pid]);
  }
}

export async function restorePage(id: string) {
  const rows = await db().all<{ deleted_at: number | null; parent_id: string | null }>(
    "SELECT deleted_at, parent_id FROM pages WHERE id = ?",
    [id],
  );
  const stamp = rows[0]?.deleted_at;
  if (stamp == null) return;
  // Si le parent est resté dans la corbeille, la page revient à la racine.
  const parent = rows[0].parent_id
    ? await db().all("SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL", [rows[0].parent_id])
    : [];
  if (rows[0].parent_id && parent.length === 0)
    await db().run("UPDATE pages SET parent_id = NULL WHERE id = ?", [id]);
  for (const pid of await subtree(id)) {
    await db().run("UPDATE pages SET deleted_at = NULL WHERE id = ? AND deleted_at = ?", [pid, stamp]);
    await reindex(pid);
  }
}

export async function deletePageForever(id: string) {
  for (const pid of await subtree(id)) {
    await db().run("DELETE FROM pages WHERE id = ?", [pid]);
    await db().run("DELETE FROM pages_fts WHERE page_id = ?", [pid]);
    await db().run("DELETE FROM links WHERE source_id = ? OR target_id = ?", [pid, pid]);
    await db().run("DELETE FROM cards WHERE page_id = ?", [pid]);
    await db().run("UPDATE tasks SET course_id = NULL WHERE course_id = ?", [pid]);
  }
}

export type SearchHit = { id: string; title: string; icon: string | null; snippet: string };

/** Les correspondances sont encadrées par \u0001 et \u0002 dans `snippet`. */
export async function searchPages(query: string): Promise<SearchHit[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  return db().all<SearchHit>(
    `SELECT p.id, p.title, p.icon,
            snippet(pages_fts, 2, char(1), char(2), '…', 14) AS snippet
     FROM pages_fts JOIN pages p ON p.id = pages_fts.page_id
     WHERE pages_fts MATCH ? ORDER BY bm25(pages_fts, 0, 8, 1) LIMIT 30`,
    [fts],
  );
}

export const backlinks = (id: string) =>
  db().all<PageMeta>(
    `SELECT ${META} FROM pages WHERE deleted_at IS NULL
     AND id IN (SELECT source_id FROM links WHERE target_id = ?) ORDER BY title`,
    [id],
  );
