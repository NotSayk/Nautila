/** Export et import CSV d'une base de données (fonctions pures). */
import { inferColumn, isoDate } from "./csv";
import { cellValue, isComputed, OPTION_COLORS, type Option, type Prop, type Row, type Value } from "./dbquery";

/** Écrit un CSV : les champs ne sont mis entre guillemets que s'il le faut ; BOM en tête pour qu'Excel lise l'UTF-8. */
export function toCsv(table: string[][]): string {
  const field = (cell: string) => (/[",\r\n]|^\s|\s$/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);
  return `﻿${table.map((row) => row.map(field).join(",")).join("\r\n")}\r\n`;
}

export type ExportContext = {
  /** En-tête de la colonne du titre, et libellés des cases à cocher. */
  labels: { title: string; yes: string; no: string };
  /** Titre d'une page liée (relation). */
  titleOf: (id: string) => string | null;
  /** Nom d'un fichier joint, d'après son adresse. */
  fileName: (url: string) => string | null;
};

/** Texte d'une cellule : le même que celui qu'on relit à l'import (noms des choix, titres des pages liées…). */
export function cellText(prop: Prop | "title", row: Row, ctx: ExportContext): string {
  const value = cellValue(row, prop);
  if (prop === "title") return row.title;
  if (prop.type === "checkbox") return value ? ctx.labels.yes : ctx.labels.no;
  if (value == null) return "";
  switch (prop.type) {
    case "select":
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [String(value)];
      return ids.flatMap((id) => prop.options?.find((o) => o.id === id)?.name ?? []).join(", ");
    }
    case "relation":
      return (Array.isArray(value) ? value : []).flatMap((id) => ctx.titleOf(id) ?? []).join(", ");
    case "files":
      return (Array.isArray(value) ? value : []).flatMap((url) => ctx.fileName(url) ?? []).join(", ");
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

/** Tableau à écrire : l'en-tête puis une ligne par ligne de la base, dans l'ordre des propriétés données. */
export function exportTable(props: Prop[], rows: Row[], ctx: ExportContext): string[][] {
  return [
    [ctx.labels.title, ...props.map((p) => p.name)],
    ...rows.map((row) => ["title" as const, ...props].map((p) => cellText(p, row, ctx))),
  ];
}

/** Colonnes de la base qu'un import peut remplir (les résultats calculés, relations et fichiers sont laissés de côté). */
const importable = (p: Prop) => !isComputed(p.type) && p.type !== "relation" && p.type !== "files";

const TITLE_NAMES = ["name", "nom", "title", "titre"];

export type ImportPlan = {
  /** Propriétés de la base après l'import : les existantes (options complétées) puis les nouvelles. */
  props: Prop[];
  added: string[];
  items: { title: string; props: Record<string, Value> }[];
  /** Colonnes du fichier ignorées faute de propriété compatible. */
  skipped: string[];
};

const norm = (s: string) => s.trim().toLowerCase();
const split = (cell: string) =>
  cell
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Prépare l'import d'un CSV dans une base existante : les colonnes s'associent aux propriétés de même nom
 * (sans tenir compte de la casse), les autres deviennent de nouvelles propriétés dont le type est déduit.
 * La colonne du titre est « Nom », « Title »… ou, à défaut, la première. Renvoie null si le fichier n'a aucune ligne.
 */
export function planImport(table: string[][], existing: Prop[], newId: () => string): ImportPlan | null {
  const [header, ...body] = table;
  if (!header || body.length === 0) return null;
  const names = header.map((h) => h.trim());
  const cell = (r: string[], i: number) => r[i] ?? "";

  let titleAt = names.findIndex((n) => TITLE_NAMES.includes(norm(n)));
  if (titleAt < 0) titleAt = 0;

  const props: Prop[] = existing.map((p) => (p.options ? { ...p, options: [...p.options] } : { ...p }));
  const used = new Set<string>();
  const added: string[] = [];
  const skipped: string[] = [];
  const readers: { at: number; prop: Prop; read: (c: string) => Value }[] = [];

  names.forEach((name, i) => {
    if (i === titleAt) return;
    const column = body.map((r) => cell(r, i));
    if (!name && column.every((c) => !c.trim())) return;
    const label = name || `${i + 1}`;
    const match = props.find((p) => norm(p.name) === norm(label) && !used.has(p.id));
    if (match) {
      used.add(match.id);
      if (!importable(match)) {
        skipped.push(label);
        return;
      }
      readers.push({ at: i, prop: match, read: reader(match, newId) });
      return;
    }
    const { prop, convert } = inferColumn(label, column, newId());
    props.push(prop);
    added.push(prop.id);
    readers.push({ at: i, prop, read: convert });
  });

  const items = body.map((r) => {
    const values: Record<string, Value> = {};
    for (const { at, prop, read } of readers) {
      const value = read(cell(r, at));
      // Une case décochée revient au même qu'une valeur absente : on ne l'écrit pas.
      if (value !== null && value !== undefined && value !== "" && value !== false) values[prop.id] = value;
    }
    return { title: cell(r, titleAt).trim(), props: values };
  });
  return { props, added, items, skipped };
}

/** Lecture d'une cellule pour une propriété existante ; les choix inconnus sont ajoutés à la propriété. */
function reader(prop: Prop, newId: () => string): (cell: string) => Value {
  const optionFor = (label: string): string => {
    const options = (prop.options ??= []);
    let found: Option | undefined = options.find((o) => norm(o.name) === norm(label));
    if (!found) {
      found = { id: newId(), name: label, color: OPTION_COLORS[options.length % OPTION_COLORS.length] };
      options.push(found);
    }
    return found.id;
  };
  switch (prop.type) {
    case "number":
      return (c) => {
        const n = Number(c.trim().replace(/\s/g, "").replace(",", "."));
        return c.trim() && Number.isFinite(n) ? n : null;
      };
    case "checkbox":
      return (c) => /^(yes|true|oui|1|x|✓)$/i.test(c.trim());
    case "date":
      return (c) => (c.trim() ? isoDate(c) : null);
    case "select":
      return (c) => (c.trim() ? optionFor(c.trim()) : null);
    case "multi_select":
      return (c) => {
        const ids = split(c).map(optionFor);
        return ids.length ? [...new Set(ids)] : null;
      };
    default:
      return (c) => c.trim() || null;
  }
}
