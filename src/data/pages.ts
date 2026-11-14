import { db } from "../db";
import type { SqlValue, Statement } from "../db/types";
import { cardStatements, insertCard } from "./cards";
import { splitClozeId } from "./cloze";
import { snapshotStatements } from "./versions";
import { toFtsQuery, type Extracted } from "./extract";
import { collectFiles, fileId, linkStatements } from "./files";

/** « synced » : contenu d'un bloc synchronisé, jamais listé comme une page. */
export type PageKind = "note" | "course" | "semester" | "database" | "synced";
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
  /** Identifiant de la page partagée sur le serveur, si elle est partagée en direct. */
  share_id: string | null;
  /** Étiquettes, sous forme de tableau JSON. */
  tags: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const META =
  "id, parent_id, kind, title, icon, position, favorite, full_width, cover, locked, font, small_text, share_id, tags, created_at, updated_at, deleted_at";

export const listPages = () =>
  db().all<PageMeta>(
    `SELECT ${META} FROM pages WHERE deleted_at IS NULL AND kind != 'synced' ORDER BY position, created_at`,
  );

export const listTrash = () =>
  db().all<PageMeta>(
    `SELECT ${META} FROM pages WHERE deleted_at IS NOT NULL AND kind != 'synced' ORDER BY deleted_at DESC`,
  );

/** Contenu d'une page : son état Yjs, ou du Markdown à mettre en forme si elle a été créée ailleurs. */
export async function getPageDoc(id: string): Promise<{ ydoc: string | null; markdown: string | null }> {
  const rows = await db().all<{ ydoc: string | null; import_md: string | null }>(
    "SELECT ydoc, import_md FROM pages WHERE id = ?",
    [id],
  );
  return { ydoc: rows[0]?.ydoc ?? null, markdown: rows[0]?.import_md ?? null };
}

/** Remet la page dans l'index de recherche (hors corbeille). */
const reindexStatements = (id: string): Statement[] => [
  { sql: "DELETE FROM pages_fts WHERE page_id = ?", params: [id] },
  {
    sql: "INSERT INTO pages_fts (page_id, title, body) SELECT id, title, body FROM pages WHERE id = ? AND deleted_at IS NULL",
    params: [id],
  },
];

export async function createPage(input: {
  parentId?: string | null;
  kind?: PageKind;
  title?: string;
  icon?: string | null;
  /** Identifiant imposé (pages déterministes comme la note du jour) et position dans le parent. */
  id?: string;
  position?: number;
}): Promise<PageMeta> {
  const now = Date.now();
  const page: PageMeta = {
    id: input.id ?? crypto.randomUUID(),
    parent_id: input.parentId ?? null,
    kind: input.kind ?? "note",
    title: input.title ?? "",
    icon: input.icon ?? null,
    position: input.position ?? now,
    favorite: 0,
    full_width: 0,
    cover: null,
    locked: 0,
    font: "sans",
    small_text: 0,
    share_id: null,
    tags: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db().batch([
    {
      sql: "INSERT INTO pages (id, parent_id, kind, title, icon, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      params: [page.id, page.parent_id, page.kind, page.title, page.icon, page.position, now, now],
    },
    ...reindexStatements(page.id),
  ]);
  return page;
}

export type PagePatch = {
  title?: string;
  kind?: PageKind;
  share_id?: string | null;
  tags?: string | null;
  icon?: string | null;
  cover?: string | null;
  font?: PageFont;
  favorite?: boolean;
  full_width?: boolean;
  locked?: boolean;
  small_text?: boolean;
};

const PATCH_COLUMNS = new Set([
  "title",
  "kind",
  "share_id",
  "tags",
  "icon",
  "cover",
  "font",
  "favorite",
  "full_width",
  "locked",
  "small_text",
]);

/** Modifie les métadonnées d'une page ; sa date de modification n'avance que si une valeur change vraiment. */
export async function updatePageMeta(id: string, patch: PagePatch) {
  const wanted = Object.entries(patch)
    .filter(([key, value]) => value !== undefined && PATCH_COLUMNS.has(key))
    .map(([key, value]) => [key, typeof value === "boolean" ? Number(value) : (value as SqlValue)] as const);
  if (wanted.length === 0) return;
  // Les noms de colonnes viennent de la liste ci-dessus, jamais d'une saisie.
  const [current] = await db().all<Record<string, SqlValue>>(
    `SELECT ${wanted.map(([key]) => key).join(", ")} FROM pages WHERE id = ?`,
    [id],
  );
  if (!current) return;
  const changed = wanted.filter(([key, value]) => current[key] !== value);
  const statements: Statement[] = [];
  if (changed.length > 0)
    statements.push({
      sql: `UPDATE pages SET ${changed.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
      params: [...changed.map(([, value]) => value), Date.now(), id],
    });
  if (patch.cover) statements.push(...linkStatements(id, [fileId(patch.cover)]));
  if (changed.some(([key]) => key === "title")) statements.push(...reindexStatements(id));
  if (statements.length > 0) await db().batch(statements);
}

/** Déplace une page ; refuse de la placer dans sa propre descendance. */
export async function movePage(id: string, parentId: string | null, position?: number): Promise<boolean> {
  if (parentId && (await subtree(id)).includes(parentId)) return false;
  await db().run("UPDATE pages SET parent_id = ?, position = ? WHERE id = ?", [parentId, position ?? Date.now(), id]);
  return true;
}

/** Copie une page et ses sous-pages (une seule transaction) ; renvoie l'identifiant de la copie. */
export async function duplicatePage(id: string, suffix: string): Promise<string> {
  const [src] = await db().all<{ parent_id: string | null }>("SELECT parent_id FROM pages WHERE id = ?", [id]);
  if (!src) throw new Error("page not found");
  const tree = await db().all<{ id: string; parent_id: string | null }>(
    `WITH RECURSIVE tree(id, parent_id) AS (
       SELECT id, parent_id FROM pages WHERE id = ?
       UNION ALL SELECT p.id, p.parent_id FROM pages p JOIN tree t ON p.parent_id = t.id WHERE p.deleted_at IS NULL
     ) SELECT id, parent_id FROM tree`,
    [id],
  );
  const copyOf = new Map(tree.map((p) => [p.id, crypto.randomUUID()]));
  const now = Date.now();
  const statements: Statement[] = [];
  for (const page of tree) {
    const newId = copyOf.get(page.id)!;
    const top = page.id === id;
    // La copie racine passe en dernier de sa fratrie ; les sous-pages gardent leur position (colonne NOT NULL).
    statements.push({
      sql: `INSERT INTO pages (id, parent_id, kind, title, icon, position, ydoc, body, import_md, cover, font, small_text, full_width, props, tags, created_at, updated_at)
       SELECT ?, ?, kind, title || ?, icon, ${top ? "?" : "position"}, ydoc, body, import_md, cover, font, small_text, full_width, props, tags, ?, ? FROM pages WHERE id = ?`,
      params: [
        newId,
        top ? src.parent_id : (copyOf.get(page.parent_id ?? "") ?? null),
        top ? suffix : "",
        ...(top ? [now] : []),
        now,
        now,
        page.id,
      ],
    });
    statements.push(...reindexStatements(newId));
    statements.push(
      {
        sql: "INSERT INTO databases (page_id, config) SELECT ?, config FROM databases WHERE page_id = ?",
        params: [newId, page.id],
      },
      {
        sql: "INSERT INTO page_files (page_id, file_id) SELECT ?, file_id FROM page_files WHERE page_id = ?",
        params: [newId, page.id],
      },
      {
        sql: "INSERT INTO links (source_id, target_id) SELECT ?, target_id FROM links WHERE source_id = ?",
        params: [newId, page.id],
      },
    );
    // Les cartes repartent de zéro : la copie a sa propre progression, dans le même ordre.
    const cards = await db().all<{ id: string; front: string; back: string }>(
      "SELECT id, front, back FROM cards WHERE page_id = ? ORDER BY created_at, id",
      [page.id],
    );
    // Les trous d'une même carte (« …#c1 », « …#c2 ») restent ensemble dans la copie.
    const copied = new Map<string, string>();
    cards.forEach((c, i) => {
      const { base } = splitClozeId(c.id);
      if (!copied.has(base)) copied.set(base, copiedCardId(page.id, newId, base));
      const id = base === c.id ? copied.get(base)! : `${copied.get(base)}${c.id.slice(base.length)}`;
      statements.push(insertCard(id, newId, c.front, c.back, now + i));
    });
  }
  await db().batch(statements);
  return copyOf.get(id)!;
}

/**
 * Identifiant d'une carte dans la copie. Une carte de bloc s'appelle « <page>:<bloc> » et suit sa page ;
 * une carte ajoutée à la main ou par le connecteur MCP (« extra:<uuid> ») reçoit un nouvel uuid, car
 * l'identifiant d'une carte est unique dans toute la base.
 */
function copiedCardId(sourceId: string, newId: string, cardId: string): string {
  if (cardId.startsWith(`${sourceId}:`)) return `${newId}:${cardId.slice(sourceId.length + 1)}`;
  return cardId.startsWith("extra:") ? `extra:${crypto.randomUUID()}` : `${newId}:${cardId}`;
}

/**
 * Enregistre le contenu d'une page, son index, son historique, ses liens, ses cartes et ses fichiers
 * dans une seule transaction. Les liens et les cartes ne sont réécrits que s'ils ont changé : chaque
 * écriture alourdit le journal de synchronisation.
 */
export async function savePageContent(id: string, ydoc: string, extracted: Extracted) {
  const known = await db().all<{ target_id: string }>("SELECT target_id FROM links WHERE source_id = ?", [id]);
  const wanted = new Set(extracted.links);
  const statements: Statement[] = [
    {
      sql: "UPDATE pages SET ydoc = ?, body = ?, import_md = NULL, updated_at = ? WHERE id = ?",
      params: [ydoc, extracted.body, Date.now(), id],
    },
    ...reindexStatements(id),
    ...(await snapshotStatements(id, ydoc, extracted.body)),
  ];
  for (const { target_id } of known)
    if (!wanted.has(target_id))
      statements.push({ sql: "DELETE FROM links WHERE source_id = ? AND target_id = ?", params: [id, target_id] });
  const had = new Set(known.map((k) => k.target_id));
  for (const target of wanted)
    if (!had.has(target))
      statements.push({
        sql: "INSERT OR IGNORE INTO links (source_id, target_id) VALUES (?, ?)",
        params: [id, target],
      });
  statements.push(...(await cardStatements(id, extracted.cards)));
  // Les liens vers les fichiers ne sont jamais retirés tant que la page existe :
  // une version de l'historique peut encore les utiliser.
  statements.push(...linkStatements(id, extracted.files));
  await db().batch(statements);
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
  const statements: Statement[] = [];
  for (const pid of await subtree(id))
    statements.push(
      { sql: "UPDATE pages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", params: [now, pid] },
      { sql: "DELETE FROM pages_fts WHERE page_id = ?", params: [pid] },
    );
  await db().batch(statements);
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
  const statements: Statement[] = [];
  if (rows[0].parent_id && parent.length === 0)
    statements.push({ sql: "UPDATE pages SET parent_id = NULL WHERE id = ?", params: [id] });
  for (const pid of await subtree(id))
    statements.push(
      { sql: "UPDATE pages SET deleted_at = NULL WHERE id = ? AND deleted_at = ?", params: [pid, stamp] },
      ...reindexStatements(pid),
    );
  await db().batch(statements);
}

export async function deletePageForever(id: string) {
  const statements: Statement[] = [];
  for (const pid of await subtree(id)) {
    const one = [pid];
    statements.push(
      { sql: "DELETE FROM pages WHERE id = ?", params: one },
      { sql: "DELETE FROM pages_fts WHERE page_id = ?", params: one },
      { sql: "DELETE FROM links WHERE source_id = ? OR target_id = ?", params: [pid, pid] },
      { sql: "DELETE FROM cards WHERE page_id = ?", params: one },
      { sql: "DELETE FROM databases WHERE page_id = ?", params: one },
      { sql: "DELETE FROM versions WHERE page_id = ?", params: one },
      { sql: "DELETE FROM page_files WHERE page_id = ?", params: one },
      { sql: "UPDATE slots SET course_id = NULL WHERE course_id = ?", params: one },
      { sql: "UPDATE events SET course_id = NULL WHERE course_id = ?", params: one },
      { sql: "UPDATE tasks SET course_id = NULL WHERE course_id = ?", params: one },
    );
  }
  await db().batch(statements);
  await collectFiles();
}

export type SearchHit = { id: string; title: string; icon: string | null; kind: PageKind; snippet: string };

/** Les correspondances sont encadrées par \u0001 et \u0002 dans `snippet`. */
export async function searchPages(query: string): Promise<SearchHit[]> {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  return db().all<SearchHit>(
    `SELECT p.id, p.title, p.icon, p.kind,
            snippet(pages_fts, 2, char(1), char(2), '…', 14) AS snippet
     FROM pages_fts JOIN pages p ON p.id = pages_fts.page_id
     WHERE pages_fts MATCH ? AND p.kind != 'synced' ORDER BY bm25(pages_fts, 0, 8, 1) LIMIT 60`,
    [fts],
  );
}

export const backlinks = (id: string) =>
  db().all<PageMeta>(
    `SELECT ${META} FROM pages WHERE deleted_at IS NULL
     AND id IN (SELECT source_id FROM links WHERE target_id = ?) ORDER BY title`,
    [id],
  );

/** Remplace le contenu d'une page (restauration d'une version, application d'un modèle). */
export async function replacePageDoc(id: string, ydoc: string, body = "") {
  await db().batch([
    { sql: "UPDATE pages SET ydoc = ?, body = ?, updated_at = ? WHERE id = ?", params: [ydoc, body, Date.now(), id] },
    ...reindexStatements(id),
  ]);
}

/** Étiquettes d'une page, lues depuis leur colonne JSON. */
export function pageTags(page: Pick<PageMeta, "tags">): string[] {
  try {
    const tags = JSON.parse(page.tags ?? "[]");
    return Array.isArray(tags) ? tags.map(String) : [];
  } catch {
    return [];
  }
}
