import { db } from "../db";

export type CustomTemplate = { id: string; name: string; ydoc: string };

export const listTemplates = () => db().all<CustomTemplate>("SELECT id, name, ydoc FROM templates ORDER BY created_at");

export const saveTemplate = (name: string, ydoc: string) =>
  db().run("INSERT INTO templates (id, name, ydoc, created_at) VALUES (?,?,?,?)", [
    crypto.randomUUID(),
    name,
    ydoc,
    Date.now(),
  ]);

export const deleteTemplate = (id: string) => db().run("DELETE FROM templates WHERE id = ?", [id]);

/** Contenu Markdown en attente d'être posé dans une page tout juste importée. */
export const pendingMarkdown = new Map<string, string>();
