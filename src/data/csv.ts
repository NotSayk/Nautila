import { OPTION_COLORS, type Prop, type Value } from "./dbquery";

/** Lit un CSV (guillemets, virgules et retours à la ligne dans les champs compris). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const isoDate = (value: string): string | null => {
  // Notion écrit « January 5, 2024 » et, pour une période, « début → fin » : on garde le début.
  const first = value.split("→")[0].trim();
  if (!/\d{4}/.test(first)) return null;
  const time = Date.parse(first);
  if (Number.isNaN(time)) return null;
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Déduit le type d'une colonne de ses valeurs, et renvoie de quoi convertir chaque cellule. */
export function inferColumn(
  name: string,
  values: string[],
  id: string,
): { prop: Prop; convert: (cell: string) => Value } {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  const all = (test: (v: string) => boolean) => filled.length > 0 && filled.every(test);

  if (all((v) => /^-?\d+([.,]\d+)?$/.test(v)))
    return {
      prop: { id, name, type: "number" },
      convert: (c) => (c.trim() ? Number(c.trim().replace(",", ".")) : null),
    };
  if (all((v) => /^(yes|no|true|false|oui|non)$/i.test(v)))
    return { prop: { id, name, type: "checkbox" }, convert: (c) => /^(yes|true|oui)$/i.test(c.trim()) };
  if (all((v) => /^https?:\/\//.test(v))) return { prop: { id, name, type: "url" }, convert: (c) => c.trim() || null };
  if (all((v) => isoDate(v) !== null))
    return { prop: { id, name, type: "date" }, convert: (c) => (c.trim() ? isoDate(c) : null) };

  // Peu de valeurs différentes, et répétées : une liste de choix.
  const distinct = [...new Set(filled)];
  if (distinct.length <= 10 && distinct.length < filled.length && distinct.every((v) => v.length <= 40)) {
    const options = distinct.map((value, i) => ({
      id: `${id}-${i}`,
      name: value,
      color: OPTION_COLORS[i % OPTION_COLORS.length],
    }));
    return {
      prop: { id, name, type: "select", options },
      convert: (c) => options.find((o) => o.name === c.trim())?.id ?? null,
    };
  }
  return { prop: { id, name, type: "text" }, convert: (c) => c.trim() || null };
}
