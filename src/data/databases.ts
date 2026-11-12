import { db } from "../db";
import type { DbConfig, DbView, Row, Value, ViewType } from "./dbquery";
import { createPage } from "./pages";

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
