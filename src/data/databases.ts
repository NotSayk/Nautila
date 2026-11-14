import { db } from "../db";
import type { RelatedBase } from "./dbcalc";
import { stripOptions, withFormulas, type DbConfig, type DbView, type Prop, type Row, type Value, type ViewType } from "./dbquery";
import { fileId, linkFiles, saveFile } from "./files";
import { createPage, duplicatePage } from "./pages";

const uid = () => crypto.randomUUID().slice(0, 8);

export function newView(type: ViewType, name: string): DbView {
  return { id: uid(), name, type, filters: [], sort: null };
}

export async function getDatabase(pageId: string): Promise<DbConfig | null> {
  const [row] = await db().all<{ config: string }>("SELECT config FROM databases WHERE page_id = ?", [pageId]);
  return row ? (JSON.parse(row.config) as DbConfig) : null;
}

export const saveDatabase = (pageId: string, config: DbConfig) =>
  db().run(
    "INSERT INTO databases (page_id, config) VALUES (?, ?) ON CONFLICT(page_id) DO UPDATE SET config = excluded.config",
    [pageId, JSON.stringify(config)],
  );

export async function listRows(databaseId: string): Promise<Row[]> {
  const rows = await db().all<Omit<Row, "props"> & { props: string | null }>(
    `SELECT id, title, icon, cover, props, position, created_at, updated_at FROM pages
     WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position`,
    [databaseId],
  );
  return rows.map((r) => ({ ...r, props: r.props ? JSON.parse(r.props) : {} }));
}

export async function getRowProps(pageId: string): Promise<Record<string, Value>> {
  const [row] = await db().all<{ props: string | null }>("SELECT props FROM pages WHERE id = ?", [pageId]);
  return row?.props ? JSON.parse(row.props) : {};
}

export async function createRow(databaseId: string, props: Record<string, Value> = {}): Promise<string> {
  const page = await createPage({ parentId: databaseId });
  await setRowProps(page.id, props);
  return page.id;
}

export const setRowProps = (pageId: string, props: Record<string, Value>) =>
  db().run("UPDATE pages SET props = ?, updated_at = ? WHERE id = ?", [JSON.stringify(props), Date.now(), pageId]);

/** Place une ligne dans l'ordre manuel de la base. */
export const setRowPosition = (pageId: string, position: number) =>
  db().run("UPDATE pages SET position = ? WHERE id = ?", [position, pageId]);

/** Copie une ligne (propriétés et contenu), juste après l'original quand `position` est donnée. */
export async function duplicateRow(id: string, suffix: string, position?: number): Promise<string> {
  const copy = await duplicatePage(id, suffix);
  if (position !== undefined) await setRowPosition(copy, position);
  return copy;
}

/** Lignes créées d'un coup (import) : un nom et des valeurs chacune. */
export async function createRows(
  databaseId: string,
  items: { title: string; props: Record<string, Value> }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const page = await createPage({ parentId: databaseId, title: item.title });
    await setRowProps(page.id, item.props);
    ids.push(page.id);
  }
  return ids;
}

/** Réécrit les valeurs des lignes de la base ; `change` renvoie les nouvelles valeurs, ou null pour laisser la ligne. Renvoie les lignes modifiées. */
export async function updateRows(
  databaseId: string,
  change: (props: Record<string, Value>, row: Row) => Record<string, Value> | null,
): Promise<Row[]> {
  const changed: Row[] = [];
  for (const row of await listRows(databaseId)) {
    const props = change(row.props, row);
    if (!props) continue;
    await setRowProps(row.id, props);
    changed.push({ ...row, props });
  }
  return changed;
}

/** Retire des lignes de la base les options supprimées d'une propriété ; renvoie les lignes modifiées. */
export const purgeOptions = (databaseId: string, propId: string, removed: string[]): Promise<Row[]> =>
  updateRows(databaseId, (props) => stripOptions(props, propId, removed));

/** Rétablit les valeurs d'une propriété d'avant une conversion (annulation). */
export const restoreValues = (databaseId: string, propId: string, before: Map<string, Value>): Promise<Row[]> =>
  updateRows(databaseId, (props, row) => (before.has(row.id) ? { ...props, [propId]: before.get(row.id) } : null));

/** Contenu des bases liées, pour calculer les rollups. */
export async function loadRelated(ids: string[]): Promise<Map<string, RelatedBase>> {
  const related = new Map<string, RelatedBase>();
  for (const id of ids) {
    const config = await getDatabase(id);
    if (!config) continue;
    related.set(id, { props: config.props, rows: withFormulas(await listRows(id), config.props) });
  }
  return related;
}

const asIds = (v: Value) => (Array.isArray(v) ? v : []);

/** Relation bidirectionnelle : répercute sur la propriété miroir des lignes liées les liens ajoutés et retirés. */
export async function syncTwin(rowId: string, prop: Prop, before: Value, after: Value): Promise<void> {
  if (!prop.twin || !prop.target) return;
  // Le miroir a pu être supprimé depuis l'autre base.
  const target = await getDatabase(prop.target);
  if (!target?.props.some((p) => p.id === prop.twin)) return;
  const [old, next] = [asIds(before), asIds(after)];
  for (const id of next.filter((x) => !old.includes(x))) {
    const props = await getRowProps(id);
    const current = asIds(props[prop.twin]);
    if (!current.includes(rowId)) await setRowProps(id, { ...props, [prop.twin]: [...current, rowId] });
  }
  for (const id of old.filter((x) => !next.includes(x))) {
    const props = await getRowProps(id);
    const current = asIds(props[prop.twin]);
    if (current.includes(rowId)) {
      const left = current.filter((x) => x !== rowId);
      await setRowProps(id, { ...props, [prop.twin]: left.length ? left : null });
    }
  }
}

/**
 * Crée la propriété miroir d'une relation dans la base liée, relie les deux et recopie les liens existants.
 * Renvoie la configuration de la base courante à enregistrer (la base liée l'est déjà).
 */
export async function addMirror(sourceId: string, config: DbConfig, propId: string, name: string): Promise<DbConfig> {
  const prop = config.props.find((p) => p.id === propId);
  if (!prop?.target || prop.twin) return config;
  const mirror: Prop = { id: uid(), name, type: "relation", target: sourceId, twin: propId };
  const linked = (p: Prop) => (p.id === propId ? { ...p, twin: mirror.id } : p);
  let next: DbConfig;
  if (prop.target === sourceId) next = { ...config, props: [...config.props.map(linked), mirror] };
  else {
    const other = await getDatabase(prop.target);
    if (!other) return config;
    await saveDatabase(prop.target, { ...other, props: [...other.props, mirror] });
    next = { ...config, props: config.props.map(linked) };
  }
  // Liens déjà posés : chaque ligne liée reçoit le lien inverse.
  const inverse = new Map<string, string[]>();
  for (const row of await listRows(sourceId))
    for (const id of asIds(row.props[propId])) inverse.set(id, [...(inverse.get(id) ?? []), row.id]);
  for (const [id, sources] of inverse) {
    const props = await getRowProps(id);
    await setRowProps(id, { ...props, [mirror.id]: [...new Set([...asIds(props[mirror.id]), ...sources])] });
  }
  return next;
}

/** La propriété `twinId` de l'autre base perd son lien miroir (la relation d'origine a été supprimée). */
export async function unlinkTwin(databaseId: string, twinId: string): Promise<void> {
  const config = await getDatabase(databaseId);
  if (!config?.props.some((p) => p.id === twinId)) return;
  await saveDatabase(databaseId, {
    ...config,
    props: config.props.map((p) => {
      if (p.id !== twinId) return p;
      const { twin: _twin, ...rest } = p;
      return rest;
    }),
  });
}

/** Nom et type des fichiers joints, d'après leurs adresses. */
export async function fileInfos(urls: string[]): Promise<Map<string, { name: string; mime: string }>> {
  const ids = urls.flatMap((u) => fileId(u) ?? []);
  const infos = new Map<string, { name: string; mime: string }>();
  if (ids.length === 0) return infos;
  const rows = await db().all<{ id: string; name: string; mime: string }>(
    `SELECT id, name, mime FROM files WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  for (const r of rows) infos.set(`nautila-file:${r.id}`, { name: r.name, mime: r.mime });
  return infos;
}

/** Enregistre un fichier et le rattache à la ligne (il ne sera pas nettoyé tant qu'elle existe) ; renvoie son adresse. */
export async function attachFile(rowId: string, file: File): Promise<string> {
  const url = await saveFile(file);
  await linkFiles(rowId, [fileId(url)]);
  return url;
}
