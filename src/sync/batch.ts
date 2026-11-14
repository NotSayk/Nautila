/** Lignes envoyées par requête, et taille visée d'un lot. */
export const PUSH_ROWS = 40;
export const PUSH_BYTES = 8 * 1024 * 1024;
/** Au-delà, une ligne dépasserait la taille de requête acceptée par le serveur (48 Mo) : elle n'est pas envoyée. */
export const MAX_ROW_BYTES = 40 * 1024 * 1024;

export type Pending = { tbl: string; id: string; at: number };
export type Outgoing<T> = Pending & { data: T | null };

/** Repère d'une modification en attente ; il change dès que la ligne est modifiée à nouveau. */
export const pendingMark = (p: Pending) => `${p.tbl}\u0000${p.id}\u0000${p.at}`;

/**
 * Compose le prochain lot à envoyer : au plus `limit` lignes et PUSH_BYTES octets (une ligne seule
 * peut dépasser cette taille). Les lignes trop grosses pour le serveur sont mises de côté dans `oversized`.
 */
export async function nextBatch<T>(
  pending: Pending[],
  load: (p: Pending) => Promise<T | null>,
  limit: number,
): Promise<{ changes: Outgoing<T>[]; oversized: Pending[]; consumed: number }> {
  const changes: Outgoing<T>[] = [];
  const oversized: Pending[] = [];
  let bytes = 0;
  let consumed = 0;
  for (const p of pending) {
    if (changes.length >= limit) break;
    const data = await load(p);
    const size = data ? JSON.stringify(data).length : 0;
    if (size > MAX_ROW_BYTES) {
      oversized.push(p);
      consumed++;
      continue;
    }
    if (changes.length > 0 && bytes + size > PUSH_BYTES) break;
    bytes += size;
    changes.push({ ...p, data });
    consumed++;
  }
  return { changes, oversized, consumed };
}

/**
 * Suite à donner au refus d'un lot par le serveur : le découper pour trouver la ligne fautive,
 * mettre celle-ci de côté (refusée ou trop grosse), la reporter (espace du compte plein), ou abandonner.
 */
export function onPushError(status: number, message: string, size: number): "split" | "skip" | "quota" | "fail" {
  if (status !== 400 && status !== 413) return "fail";
  if (size > 1) return "split";
  if (size === 0) return "fail";
  return message === "quota exceeded" ? "quota" : "skip";
}
