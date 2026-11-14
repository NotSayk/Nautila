/** Page des versions : repli pour le navigateur, les .deb/.rpm et les échecs de mise à jour. */
export const RELEASES_URL = "https://github.com/NotSayk/Nautila/releases/latest";

/** Première vérification quelques secondes après le lancement, puis toutes les 6 heures. */
export const FIRST_CHECK_DELAY = 8_000;
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** Découpe « v1.2.3-beta.1+build » en nombres et étiquette de préversion (les métadonnées `+…` sont ignorées). */
function parse(version: string) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4]?.split(".") ?? [] };
}

/** Compare deux versions SemVer : négatif si a < b, 0 si égales, positif si a > b. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  // Une version sans préversion est plus récente que la même avec préversion (1.0.0 > 1.0.0-beta).
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1; // un identifiant numérique précède un identifiant textuel
    return p < q ? -1 : 1;
  }
  return 0;
}

/** Vrai si `found` est strictement plus récente que la version installée. */
export const isNewer = (found: string, current: string) => compareVersions(found, current) > 0;

/** Vrai si la carte de mise à jour doit s'afficher : version proposée et pas écartée par « Plus tard ». */
export const shouldOffer = (found: string | null, dismissed: string | null) => !!found && found !== dismissed;

/** Avancement du téléchargement en pourcentage entier, ou `null` si la taille totale est inconnue. */
export function progressPercent(downloaded: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)));
}
