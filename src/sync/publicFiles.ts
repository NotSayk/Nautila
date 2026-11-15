import { validShareId } from "./ids";

/** Image ou média d'une page publique hébergé sur un autre site (http, https). */
export const isExternalUrl = (url: string) => /^https?:\/\//i.test(url);

/**
 * Adresse d'un fichier cité par une page publique, écrite par un tiers : seuls les liens web
 * ordinaires et les images matricielles en ligne passent (pas de javascript:, ni de HTML ou SVG en data:).
 * Les adresses d'autres sites ne sont chargées qu'avec `allowExternal` (le lecteur l'a demandé) : sinon
 * le simple affichage de la page signalerait sa visite (adresse IP, heure) à un site choisi par l'auteur.
 */
export function publicFileUrl(origin: string, shareId: string, url: string, allowExternal = false): string {
  if (url.startsWith("nautila-file:"))
    return validShareId(shareId)
      ? `${origin}/api/public/${encodeURIComponent(shareId)}/file/${encodeURIComponent(url.slice("nautila-file:".length))}`
      : "";
  if (/^data:image\/(png|jpeg|gif|webp|avif);/i.test(url)) return url;
  return allowExternal && isExternalUrl(url) ? url : "";
}
