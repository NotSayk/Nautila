/** Outils des modes de révision (fonctions pures). */

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Compare une réponse tapée à la réponse attendue, sans tenir compte des accents, de la casse ni de la ponctuation. */
export const sameAnswer = (given: string, expected: string) =>
  normalize(given) !== "" && normalize(given) === normalize(expected);

/** Réponses proposées pour une carte : la bonne et jusqu'à trois autres, distinctes, prises dans le paquet. */
export function choicesFor<T extends { id: string; back: string }>(
  card: T,
  deck: T[],
  random: () => number = Math.random,
): string[] {
  const others = new Set<string>();
  for (const c of shuffle(deck, random)) {
    if (c.id !== card.id && normalize(c.back) !== normalize(card.back)) others.add(c.back);
    if (others.size === 3) break;
  }
  return shuffle([card.back, ...others], random);
}
