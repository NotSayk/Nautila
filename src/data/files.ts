import { db } from "../db";
import type { Statement } from "../db/types";

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
      const blob = row ? await (await fetch(`data:${row.mime};base64,${row.data}`)).blob() : await fetchSharedFile(id);
      // Introuvable pour l'instant : on réessaiera à la prochaine demande.
      if (!blob) urls.delete(id);
      return blob ? URL.createObjectURL(blob) : "";
    })();
    urls.set(id, pending);
  }
  return pending;
}

/** Un fichier récent est épargné : il peut être joint à une page pas encore enregistrée ou pas encore reçue par synchro. */
const GRACE = 3 * 24 * 3_600_000;

export const fileId = (url: string | null | undefined) =>
  url?.startsWith(FILE_SCHEME) ? url.slice(FILE_SCHEME.length) : null;

/** Instructions qui notent qu'une page (ou un modèle) utilise ces fichiers. */
export const linkStatements = (ownerId: string, ids: (string | null)[]): Statement[] =>
  ids.flatMap((id) =>
    id ? [{ sql: "INSERT OR IGNORE INTO page_files (page_id, file_id) VALUES (?, ?)", params: [ownerId, id] }] : [],
  );

/** Note qu'une page (ou un modèle) utilise ces fichiers. */
export async function linkFiles(ownerId: string, ids: (string | null)[]) {
  const statements = linkStatements(ownerId, ids);
  if (statements.length) await db().batch(statements);
}

/** Le texte brut d'un état Yjs (base64) contient les adresses des fichiers en clair : on y cherche leurs identifiants. */
function decodedText(base64: string): string {
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

/**
 * Supprime les fichiers que plus aucune page ni modèle n'utilise. Sont épargnés :
 * - les fichiers récents (GRACE) ;
 * - ceux encore cités par un contenu en attente (`import_md` d'une page importée jamais ouverte),
 *   une couverture, ou le document d'une page ou d'un modèle, même sans lien `page_files`
 *   (fichier arrivé par synchro avant son lien). Ces liens manquants sont alors rétablis.
 */
export async function collectFiles(now = Date.now()) {
  const candidates = (
    await db().all<{ id: string }>(
      "SELECT id FROM files WHERE created_at < ? AND id NOT IN (SELECT file_id FROM page_files)",
      [now - GRACE],
    )
  ).map((r) => r.id);
  if (candidates.length === 0) return;

  const doomed = new Set(candidates);
  const links: Statement[] = [];
  const spare = (id: string, owner: string) => {
    if (doomed.delete(id)) links.push(...linkStatements(owner, [id]));
  };

  // Contenus en attente, couvertures, propriétés : des champs de texte, interrogés fichier par fichier.
  for (const id of candidates) {
    const [owner] = await db().all<{ id: string }>(
      `SELECT id FROM pages WHERE instr(COALESCE(import_md, ''), ?1) > 0 OR instr(COALESCE(cover, ''), ?1) > 0
         OR instr(COALESCE(props, ''), ?1) > 0 LIMIT 1`,
      [id],
    );
    if (owner) spare(id, owner.id);
  }

  // Documents Yjs des pages et des modèles, un par un pour ne pas tout charger en mémoire.
  for (const table of ["pages", "templates"] as const) {
    const owners = await db().all<{ id: string }>(
      `SELECT id FROM ${table} ${table === "pages" ? "WHERE ydoc IS NOT NULL" : ""}`,
    );
    for (const owner of owners) {
      if (doomed.size === 0) break;
      const [row] = await db().all<{ ydoc: string | null }>(`SELECT ydoc FROM ${table} WHERE id = ?`, [owner.id]);
      const text = decodedText(row?.ydoc ?? "");
      for (const id of [...doomed]) if (text.includes(id)) spare(id, owner.id);
    }
  }

  const statements: Statement[] = [...links];
  for (const id of doomed) statements.push({ sql: "DELETE FROM files WHERE id = ?", params: [id] });
  if (statements.length) await db().batch(statements);
}
