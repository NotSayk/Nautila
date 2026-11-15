/** Identifiants de partage et secrets d'invitation : 16 octets aléatoires en base64url (22 caractères). */
const SHARE_ID = /^[\w-]{16,64}$/;

export const validShareId = (id: unknown): id is string => typeof id === "string" && SHARE_ID.test(id);

/** Identifiant de fichier (`nautila-file:<id>`) utilisable dans un chemin d'API. */
export const validFileId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,100}$/.test(id);

/**
 * Chemin d'API d'une page partagée. L'identifiant peut venir d'un lien forgé par un tiers : il est
 * vérifié puis encodé, pour ne jamais viser une autre route (`<id>\delete`, `%2e%2e\logout`…).
 */
export function sharePath(shareId: string, action?: string): string {
  if (!validShareId(shareId)) throw new Error("invalid share id");
  return `share/${encodeURIComponent(shareId)}${action ? `/${action}` : ""}`;
}

/** Lien d'invitation (`…/#/join/<id>[/<secret>]`) ou code saisi tel quel ; null s'il n'est pas valide. */
export function parseShareLink(input: string): { id: string; invite?: string } | null {
  const text = input.trim();
  const at = text.lastIndexOf("#/join/");
  const [id, invite, ...rest] = (at >= 0 ? text.slice(at + "#/join/".length) : text).split("/");
  if (rest.length > 0 || !validShareId(id) || (invite !== undefined && !validShareId(invite))) return null;
  return invite ? { id, invite } : { id };
}
