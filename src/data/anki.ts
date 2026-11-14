/**
 * Paquets au format texte d'Anki (fonctions pures) : une note par ligne, « recto ⇥ verso », avec les
 * en-têtes `#separator:…`, `#html:…` et `#… column:N` d'Anki. Les champs entre guillemets peuvent
 * contenir le séparateur et des retours à la ligne (`""` pour un guillemet).
 */
import { hasCloze } from "./cloze";
import { splitMath } from "./mathtext";

export type PlainCard = { front: string; back: string };

const NAMED: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", space: " ", pipe: "|", colon: ":" };

/** Lit les champs d'un texte séparé par `sep`, en respectant les guillemets. */
function records(body: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
    } else if (ch === sep) {
      row.push(field);
      field = "";
      fieldStart = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ugrave: "ù",
  ucirc: "û",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  deg: "°",
};

/** HTML d'Anki en texte : retours à la ligne gardés, balises retirées, entités décodées. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? all;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Formules d'Anki (MathJax `\(…\)` et `\[…\]`, LaTeX `[$]…[/$]`) vers la syntaxe des cartes. */
export const fromAnkiMath = (text: string) =>
  text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `$$${tex.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => `$${tex.trim()}$`)
    .replace(/\[\$\$\]([\s\S]+?)\[\/\$\$\]/g, (_, tex: string) => `$$${tex.trim()}$$`)
    .replace(/\[latex\]([\s\S]+?)\[\/latex\]/gi, (_, tex: string) => `$$${tex.trim()}$$`)
    .replace(/\[\$\]([\s\S]+?)\[\/\$\]/g, (_, tex: string) => `$${tex.trim()}$`);

/** Formules des cartes vers MathJax, qu'Anki affiche sans réglage. */
export const toAnkiMath = (text: string) =>
  splitMath(text)
    .map((p) => (p.kind === "text" ? p.text : p.display ? `\\[${p.tex}\\]` : `\\(${p.tex}\\)`))
    .join("");

const LOOKS_HTML = /<(br|div|p|b|i|u|span|strong|em|sub|sup|ul|ol|li|font)\b[^>]*>|&(nbsp|amp|lt|gt|quot);/i;

/** Lit un export texte d'Anki (ou tout fichier « recto ⇥ verso »). */
export function parseAnkiText(text: string): PlainCard[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let sep: string | null = null;
  let html: boolean | null = null;
  const ignored = new Set<number>();
  let start = 0;
  for (; start < lines.length; start++) {
    const m = /^#([a-z ]+):(.*)$/i.exec(lines[start]);
    if (!m) break;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "separator") sep = NAMED[value.toLowerCase()] ?? (value.length === 1 ? value : null);
    else if (key === "html") html = value.toLowerCase() === "true";
    else if (key.endsWith(" column") && /^\d+$/.test(value)) ignored.add(Number(value) - 1);
  }
  const body = lines.slice(start).join("\n");
  const first = lines.slice(start).find((l) => l.trim()) ?? "";
  sep ??= first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";

  const out: PlainCard[] = [];
  for (const row of records(body, sep)) {
    const fields = row.filter((_, i) => !ignored.has(i));
    const clean = (value = "") => {
      const plain = html === true || (html === null && LOOKS_HTML.test(value)) ? htmlToText(value) : value.trim();
      return fromAnkiMath(plain).trim();
    };
    const front = clean(fields[0]);
    const back = clean(fields[1]);
    if (front && (back || hasCloze(front))) out.push({ front, back });
  }
  return out;
}

const field = (value: string) => (/[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Paquet au format texte d'Anki ; un paquet de cartes à trous est marqué comme tel (type « Cloze »). */
export function toAnkiText(cards: PlainCard[]): string {
  const cloze = cards.map((c) => hasCloze(c.front));
  const mixed = cloze.some(Boolean) && !cloze.every(Boolean);
  const head = ["#separator:tab", "#html:false"];
  if (mixed) head.push("#notetype column:3");
  else if (cloze.length && cloze.every(Boolean)) head.push("#notetype:Cloze");
  const rows = cards.map((c, i) => {
    const cols = [field(toAnkiMath(c.front)), field(toAnkiMath(c.back))];
    if (mixed) cols.push(cloze[i] ? "Cloze" : "Basic");
    return cols.join("\t");
  });
  return `${[...head, ...rows].join("\n")}\n`;
}
