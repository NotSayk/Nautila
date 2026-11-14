/** Lecture sûre des propriétés JSON des blocs (une valeur corrompue ne doit jamais faire planter le rendu). */

/** Couleurs de surlignage d'un PDF ; « yellow » est celle des surlignages d'avant. */
export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Zone surlignée : coordonnées en fraction de la page, donc indépendantes du zoom. */
export type Highlight = {
  id: string;
  page: number;
  text: string;
  rects: { x: number; y: number; w: number; h: number }[];
  /** Absente pour les surlignages anciens : jaune. */
  color?: HighlightColor;
};

/** Trait d'un croquis ; `w` (épaisseur) est absente des anciens croquis : 2,5. */
export type Stroke = { d: string; color: string; w?: number };

export const DEFAULT_STROKE_WIDTH = 2.5;

function parseArray(json: unknown): unknown[] {
  if (typeof json !== "string") return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function parseHighlights(json: unknown): Highlight[] {
  const out: Highlight[] = [];
  for (const raw of parseArray(json)) {
    const h = raw as Partial<Highlight> | null;
    if (!h || typeof h !== "object" || typeof h.id !== "string" || !isNum(h.page) || !Array.isArray(h.rects)) continue;
    const rects = h.rects.filter((r) => r && isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h));
    const color = HIGHLIGHT_COLORS.includes(h.color as HighlightColor) ? h.color : undefined;
    out.push({
      id: h.id,
      page: h.page,
      text: typeof h.text === "string" ? h.text : "",
      rects,
      ...(color ? { color } : {}),
    });
  }
  return out;
}

/** Un tracé ne contient que des commandes de chemin SVG : le reste serait ignoré, mieux vaut le rejeter. */
const PATH = /^[MLmlZz0-9.,\s-]+$/;

export function parseStrokes(json: unknown): Stroke[] {
  const out: Stroke[] = [];
  for (const raw of parseArray(json)) {
    const s = raw as Partial<Stroke> | null;
    if (!s || typeof s !== "object" || typeof s.d !== "string" || !PATH.test(s.d)) continue;
    out.push({
      d: s.d,
      color: typeof s.color === "string" ? s.color : "currentColor",
      ...(isNum(s.w) && s.w > 0 && s.w <= 40 ? { w: s.w } : {}),
    });
  }
  return out;
}

/** Dernier bloc dans lequel on peut écrire du texte : le dernier descendant, sauf s'il n'est pas textuel. */
export function lastTextBlock<T extends { type: string; content?: unknown; children?: T[] }>(blocks: T[]): T | null {
  let last = blocks[blocks.length - 1];
  while (last?.children?.length) last = last.children[last.children.length - 1];
  if (!last || last.type === "codeBlock" || !Array.isArray(last.content)) return null;
  return last;
}
