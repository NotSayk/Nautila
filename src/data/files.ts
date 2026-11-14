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

/** Pages partagées affichées en ce moment : leurs fichiers peuvent venir du compte d'un autre participant. */
const openShares = new Map<string, number>();
export function watchSharedFiles(shareId: string): () => void {
  openShares.set(shareId, (openShares.get(shareId) ?? 0) + 1);
  return () => {
    const n = (openShares.get(shareId) ?? 1) - 1;
    if (n > 0) openShares.set(shareId, n);
    else openShares.delete(shareId);
  };
}

/** Fichier ajouté à une page partagée par un autre participant : demandé au serveur. */
async function fetchSharedFile(id: string): Promise<Blob | null> {
  if (openShares.size === 0) return null;
  const { getSyncState } = await import("../sync/engine");
  const { server, token } = await getSyncState();
  if (!server || !token) return null;
  for (const shareId of openShares.keys()) {
    try {
      const res = await fetch(`${server}/api/share/${shareId}/file/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return await res.blob();
    } catch {
      /* hors connexion : le fichier s'affichera au prochain essai */
    }
  }
  return null;
}

/** Convertit une adresse `nautila-file:` en URL affichable ; laisse les autres intactes. */
export function resolveFileUrl(url: string): Promise<string> {
  if (!url.startsWith(FILE_SCHEME)) return Promise.resolve(url);
  const id = url.slice(FILE_SCHEME.length);
  let pending = urls.get(id);
  if (!pending) {
    pending = (async () => {
      const [row] = await db().all<{ mime: string; data: string }>("SELECT mime, data FROM files WHERE id = ?", [id]);
      const blob = row
        ? await (await fetch(`data:${row.mime};base64,${row.data}`)).blob()
        : await fetchSharedFile(id);
      // Introuvable pour l'instant : on réessaiera à la prochaine demande.
      if (!blob) urls.delete(id);
      return blob ? URL.createObjectURL(blob) : "";
    })();
    urls.set(id, pending);
  }
  return pending;
}

const HOUR = 3_600_000;

export const fileId = (url: string | null | undefined) =>
  url?.startsWith(FILE_SCHEME) ? url.slice(FILE_SCHEME.length) : null;

/** Fichier stocké sur l'appareil (contenu en base64), pour l'intégrer à un export ; null s'il n'y est pas. */
export async function readStoredFile(url: string): Promise<{ name: string; mime: string; data: string } | null> {
  const id = fileId(url);
  if (!id) return null;
  const [row] = await db().all<{ name: string; mime: string; data: string }>(
    "SELECT name, mime, data FROM files WHERE id = ?",
    [id],
  );
  return row ?? null;
}

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
