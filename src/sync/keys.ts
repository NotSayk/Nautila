import { SYNC_TABLES } from "../db/schema";

/**
 * Valeurs des colonnes de clé d'une ligne, d'après son identifiant journalisé (colonnes jointes
 * par « | », voir syncTriggers). Une clé simple n'est jamais découpée : l'identifiant d'un cours
 * importé d'un fichier iCal contient lui-même des « | ». Une clé composée donne exactement autant
 * de valeurs que de colonnes.
 */
export function keyValues(table: string, id: string): string[] {
  const n = SYNC_TABLES[table]?.length ?? 1;
  if (n <= 1) return [id];
  const parts = id.split("|");
  if (parts.length > n) return [...parts.slice(0, n - 1), parts.slice(n - 1).join("|")];
  while (parts.length < n) parts.push("");
  return parts;
}

/** Condition SQL qui désigne une ligne par sa clé. */
export const keyWhere = (table: string) => SYNC_TABLES[table].map((k) => `${k} = ?`).join(" AND ");
