/**
 * Cartes à trous, avec la syntaxe d'Anki : `{{c1::texte}}` ou `{{c1::texte::indice}}` (fonctions pures).
 * Une carte qui porte plusieurs numéros de trou donne une entrée planifiée par numéro, d'identifiant
 * « <carte>#c<numéro> » : chaque trou a sa propre progression.
 */

export type ClozePart = { kind: "text"; text: string } | { kind: "cloze"; n: number; answer: string; hint: string };

const OPEN = /\{\{c(\d{1,3})::/y;

/** Fin d'un trou ouvert à `start` : les accolades de LaTeX (`\frac{1}{2}`) restent dans le trou. */
function closeAt(text: string, start: number): { answer: string; hint: string; next: number } | null {
  let depth = 0;
  let sep = -1;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\\") j++;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      if (depth > 0) depth--;
      else if (text[j + 1] === "}") {
        const answer = text.slice(start, sep < 0 ? j : sep);
        const hint = sep < 0 ? "" : text.slice(sep + 2, j);
        return { answer, hint, next: j + 2 };
      } else return null;
    } else if (ch === ":" && text[j + 1] === ":" && depth === 0 && sep < 0) {
      sep = j;
      j++;
    }
  }
  return null;
}

/** Découpe un texte en morceaux de texte et en trous. Un trou vide ou mal fermé reste du texte. */
export function parseCloze(text: string): ClozePart[] {
  const parts: ClozePart[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("{{c", i)) {
      OPEN.lastIndex = i;
      const m = OPEN.exec(text);
      const end = m ? closeAt(text, OPEN.lastIndex) : null;
      const n = m ? Number(m[1]) : 0;
      if (m && end && n > 0 && end.answer.trim()) {
        if (plain) parts.push({ kind: "text", text: plain });
        plain = "";
        parts.push({ kind: "cloze", n, answer: end.answer, hint: end.hint.trim() });
        i = end.next;
        continue;
      }
    }
    plain += text[i++];
  }
  if (plain) parts.push({ kind: "text", text: plain });
  return parts;
}

/** Numéros de trou présents dans le texte, triés. */
export const clozeNumbers = (text: string): number[] =>
  [...new Set(parseCloze(text).flatMap((p) => (p.kind === "cloze" ? [p.n] : [])))].sort((a, b) => a - b);

export const hasCloze = (text: string) => text.includes("{{c") && clozeNumbers(text).length > 0;

export const clozeId = (base: string, n: number) => `${base}#c${n}`;

/** Identifiant de la carte d'origine et numéro du trou (null pour une carte simple). */
export function splitClozeId(id: string): { base: string; n: number | null } {
  const m = /^(.*)#c(\d+)$/.exec(id);
  return m ? { base: m[1], n: Number(m[2]) } : { base: id, n: null };
}

/** Entrées planifiées d'une carte : une par numéro de trou, ou la carte elle-même. */
export function scheduledIds(base: string, front: string): string[] {
  const numbers = clozeNumbers(front);
  return numbers.length ? numbers.map((n) => clozeId(base, n)) : [base];
}

/** Réponse attendue pour le trou `n` (tous les trous si `n` est nul), plusieurs morceaux séparés par « … ». */
export function clozeAnswer(front: string, n: number | null): string {
  return parseCloze(front)
    .flatMap((p) => (p.kind === "cloze" && (n === null || p.n === n) ? [p.answer.trim()] : []))
    .join(" … ");
}

/** Recto en texte brut : le trou `n` masqué (« […] » ou son indice), les autres trous affichés. */
export function clozePrompt(front: string, n: number | null): string {
  return parseCloze(front)
    .map((p) => (p.kind === "text" ? p.text : n === null || p.n === n ? (p.hint ? `[${p.hint}]` : "[…]") : p.answer))
    .join("");
}

/** Recto en texte brut, trous remplis : pour lister les cartes ou comparer leur contenu. */
export const clozeFilled = (front: string) =>
  parseCloze(front)
    .map((p) => (p.kind === "text" ? p.text : p.answer))
    .join("");

/**
 * Entoure la sélection [start, end) d'un nouveau trou (numéro suivant le plus grand déjà utilisé).
 * Sans sélection, le curseur se place dans le trou vide ; sinon juste après le trou.
 */
export function wrapCloze(text: string, start: number, end: number): { text: string; start: number; end: number } {
  const [a, b] = start <= end ? [start, end] : [end, start];
  const n = Math.max(0, ...clozeNumbers(text)) + 1;
  const open = `{{c${n}::`;
  const inserted = `${open}${text.slice(a, b)}}}`;
  const caret = a === b ? a + open.length : a + inserted.length;
  return { text: text.slice(0, a) + inserted + text.slice(b), start: caret, end: caret };
}

/** Ce qui s'affiche et ce qui est attendu pour une entrée planifiée (carte simple ou trou). */
export type CardLike = { id: string; front: string; back: string };

/** Une ligne par carte (les trous d'une même carte regroupés), dans l'ordre d'arrivée ; `gaps` : nombre d'entrées. */
export function groupNotes<T extends CardLike>(cards: T[]): (T & { gaps: number })[] {
  const byBase = new Map<string, T & { gaps: number }>();
  for (const c of cards) {
    const { base } = splitClozeId(c.id);
    const seen = byBase.get(base);
    if (seen) seen.gaps++;
    else byBase.set(base, { ...c, gaps: 1 });
  }
  return [...byBase.values()];
}

/** Numéro du trou à masquer : null pour une carte simple ; « tous » (null aussi) pour une carte à trous non découpée. */
export function clozeOf(card: CardLike): { cloze: boolean; n: number | null } {
  if (!hasCloze(card.front)) return { cloze: false, n: null };
  return { cloze: true, n: splitClozeId(card.id).n };
}

/** Réponse attendue d'une carte : son verso, ou le contenu du trou. */
export function answerOf(card: CardLike): string {
  const { cloze, n } = clozeOf(card);
  return cloze ? clozeAnswer(card.front, n) : card.back;
}

/** Question d'une carte en texte brut : son recto, trou masqué. */
export function promptOf(card: CardLike): string {
  const { cloze, n } = clozeOf(card);
  return cloze ? clozePrompt(card.front, n) : card.front;
}
