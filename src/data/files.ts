import { db } from "../db";

/** Préfixe des adresses de fichiers stockés dans la base locale. */
export const FILE_SCHEME = "nautila-file:";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const urls = new Map<string, Promise<string>>();

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Enregistre un fichier dans la base et renvoie son adresse `nautila-file:<id>`. */
export async function saveFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("file too large");
  const id = crypto.randomUUID();
  const dataUrl = await readAsDataUrl(file);
  await db().run("INSERT INTO files (id, name, mime, data, created_at) VALUES (?,?,?,?,?)", [
    id,
    file.name,
    file.type || "application/octet-stream",
    dataUrl.slice(dataUrl.indexOf(",") + 1),
    Date.now(),
  ]);
  return FILE_SCHEME + id;
}

/** Convertit une adresse `nautila-file:` en URL affichable ; laisse les autres intactes. */
export function resolveFileUrl(url: string): Promise<string> {
  if (!url.startsWith(FILE_SCHEME)) return Promise.resolve(url);
  const id = url.slice(FILE_SCHEME.length);
  let pending = urls.get(id);
  if (!pending) {
    pending = (async () => {
      const [row] = await db().all<{ mime: string; data: string }>("SELECT mime, data FROM files WHERE id = ?", [id]);
      if (!row) return "";
      const blob = await (await fetch(`data:${row.mime};base64,${row.data}`)).blob();
      return URL.createObjectURL(blob);
    })();
    urls.set(id, pending);
  }
  return pending;
}

const HOUR = 3_600_000;

export const fileId = (url: string | null | undefined) =>
  url?.startsWith(FILE_SCHEME) ? url.slice(FILE_SCHEME.length) : null;

/** Note qu'une page (ou un modèle) utilise ces fichiers. */
export async function linkFiles(ownerId: string, ids: (string | null)[]) {
  for (const id of ids)
    if (id) await db().run("INSERT OR IGNORE INTO page_files (page_id, file_id) VALUES (?, ?)", [ownerId, id]);
}

/**
 * Supprime les fichiers que plus aucune page ni modèle n'utilise. Un fichier
 * récent est épargné : il peut être joint à une page pas encore enregistrée.
 */
export const collectFiles = (now = Date.now()) =>
  db().run("DELETE FROM files WHERE created_at < ? AND id NOT IN (SELECT file_id FROM page_files)", [now - HOUR]);
