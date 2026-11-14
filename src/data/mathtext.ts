/**
 * Formules dans le texte des cartes et des quiz : `$…$` en ligne, `$$…$$` en bloc (fonctions pures).
 * `\$` donne un dollar littéral. Pour qu'un prix (« 5 $ et 10 $ ») ne devienne pas une formule, un `$`
 * ouvrant doit être suivi d'un caractère visible et un `$` fermant précédé d'un caractère visible
 * et non suivi d'un chiffre (règle de Pandoc).
 */

export type MathPart = { kind: "text"; text: string } | { kind: "math"; tex: string; display: boolean };

const blank = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/** Position du `$$` fermant à partir de `from`, ou -1. */
function closeDisplay(text: string, from: number): number {
  for (let j = from; j < text.length - 1; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "$" && text[j + 1] === "$") return j;
  }
  return -1;
}

/** Position du `$` fermant d'une formule en ligne ouverte juste avant `from`, ou -1. */
function closeInline(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\\") j++;
    else if (ch === "\n" && text[j + 1] === "\n") return -1;
    else if (ch === "$") {
      if (text[j + 1] === "$" || blank(text[j - 1]) || /\d/.test(text[j + 1] ?? "")) continue;
      return j;
    }
  }
  return -1;
}

export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let plain = "";
  const flush = () => {
    if (plain) parts.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") {
      plain += "$";
      i += 2;
      continue;
    }
    if (ch === "$" && text[i + 1] === "$") {
      const end = closeDisplay(text, i + 2);
      const tex = end < 0 ? "" : text.slice(i + 2, end).trim();
      if (tex) {
        flush();
        parts.push({ kind: "math", tex, display: true });
        i = end + 2;
        continue;
      }
    } else if (ch === "$" && !blank(text[i + 1])) {
      const end = closeInline(text, i + 1);
      if (end > i + 1) {
        flush();
        parts.push({ kind: "math", tex: text.slice(i + 1, end), display: false });
        i = end + 1;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return parts;
}

/** Vrai si le texte contient au moins une formule. */
export const hasMath = (text: string) => text.includes("$") && splitMath(text).some((p) => p.kind === "math");
