import { db } from "../db";
import { syncCards } from "./cards";
import { toFtsQuery, type Extracted } from "./extract";

export type PageKind = "note" | "course" | "semester" | "database";
export type PageFont = "sans" | "serif" | "mono";

export type PageMeta = {
  id: string;
  parent_id: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  position: number;
  favorite: number;
  full_width: number;
  cover: string | null;
  locked: number;
  font: PageFont;
  small_text: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const META =
  "id, parent_id, kind, title, icon, position, favorite, full_width, cover, locked, font, small_text, created_at, updated_at, deleted_at";

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
    favorite: 0,
    full_width: 0,
    cover: null,
    locked: 0,
    font: "sans",
    small_text: 0,
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

export type PagePatch = {
  title?: string;
  kind?: PageKind;
  icon?: string | null;
  cover?: string | null;
  font?: PageFont;
  favorite?: boolean;
  full_width?: boolean;
  locked?: boolean;
  small_text?: boolean;
};

export async function updatePageMeta(id: string, patch: PagePatch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // Les noms de colonnes viennent du type PagePatch, jamais d'une saisie.
    await db().run(`UPDATE pages SET ${key} = ? WHERE id = ?`, [
      typeof value === "boolean" ? Number(value) : value,
      id,
    ]);
  }
  if (patch.title !== undefined) {
    await db().run("UPDATE pages SET updated_at = ? WHERE id = ?", [Date.now(), id]);
    await reindex(id);
  }
}

/** Déplace une page ; refuse de la placer dans sa propre descendance. */
export async function movePage(id: string, parentId: string | null, position?: number): Promise<boolean> {
  if (parentId && (await subtree(id)).includes(parentId)) return false;
  await db().run("UPDATE pages SET parent_id = ?, position = ? WHERE id = ?", [parentId, position ?? Date.now(), id]);
  return true;
}

/** Copie une page et ses sous-pages ; renvoie l'identifiant de la copie. */
export async function duplicatePage(id: string, suffix: string): Promise<string> {
  const copy = async (sourceId: string, parentId: string | null, top: boolean): Promise<string> => {
    const newId = crypto.randomUUID();
    const now = Date.now();
    await db().run(
      `INSERT INTO pages (id, parent_id, kind, title, icon, position, ydoc, body, cover, font, small_text, full_width, props, created_at, updated_at)
       SELECT ?, ?, kind, title || ?, icon, ?, ydoc, body, cover, font, small_text, full_width, props, ?, ? FROM pages WHERE id = ?`,
      [newId, parentId, top ? suffix : "", top ? now : null, now, now, sourceId],
    );
    if (!top)
      await db().run("UPDATE pages SET position = (SELECT position FROM pages WHERE id = ?) WHERE id = ?", [
        sourceId,
        newId,
      ]);
    await reindex(newId);
    await db().run("INSERT INTO databases (page_id, config) SELECT ?, config FROM databases WHERE page_id = ?", [
      newId,
      sourceId,
    ]);
    await db().run("INSERT INTO links (source_id, target_id) SELECT ?, target_id FROM links WHERE source_id = ?", [
      newId,
      sourceId,
    ]);
    // Les cartes repartent de zéro : la copie a sa propre progression.
    const cards = await db().all<{ id: string; front: string; back: string }>(
      "SELECT id, front, back FROM cards WHERE page_id = ?",
      [sourceId],
    );
    await syncCards(
      newId,
      cards.map((c) => ({ ...c, id: c.id.slice(sourceId.length + 1) })),
    );
    const kids = await db().all<{ id: string }>("SELECT id FROM pages WHERE parent_id = ? AND deleted_at IS NULL", [
      sourceId,
    ]);
    for (const k of kids) await copy(k.id, newId, false);
    return newId;
  };
  const [src] = await db().all<{ parent_id: string | null }>("SELECT parent_id FROM pages WHERE id = ?", [id]);
  return copy(id, src?.parent_id ?? null, true);
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
  if (rows[0].parent_id && parent.length === 0) await db().run("UPDATE pages SET parent_id = NULL WHERE id = ?", [id]);
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
    await db().run("DELETE FROM databases WHERE page_id = ?", [pid]);
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
