import { db } from "../db";
import { collectFiles } from "./files";

export type CustomTemplate = { id: string; name: string; ydoc: string };

export const listTemplates = () => db().all<CustomTemplate>("SELECT id, name, ydoc FROM templates ORDER BY created_at");

/** Enregistre le contenu d'une page comme modèle, avec les fichiers qu'elle utilise. */
export async function saveTemplate(name: string, ydoc: string, pageId: string) {
  const id = crypto.randomUUID();
  await db().batch([
    {
      sql: "INSERT INTO templates (id, name, ydoc, created_at) VALUES (?,?,?,?)",
      params: [id, name, ydoc, Date.now()],
    },
    {
      sql: "INSERT INTO page_files (page_id, file_id) SELECT ?, file_id FROM page_files WHERE page_id = ?",
      params: [id, pageId],
    },
  ]);
}

export async function deleteTemplate(id: string) {
  await db().batch([
    { sql: "DELETE FROM templates WHERE id = ?", params: [id] },
    { sql: "DELETE FROM page_files WHERE page_id = ?", params: [id] },
  ]);
  await collectFiles();
}

/** Contenu Markdown en attente d'être posé dans une page tout juste importée. */
export const pendingMarkdown = new Map<string, string>();
/** Idem pour un contenu HTML (import Word). */
export const pendingHtml = new Map<string, string>();
/** Idem pour des blocs tout faits (import PDF). */
export const pendingBlocks = new Map<string, unknown[]>();
