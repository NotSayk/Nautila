/** Modèle et requêtes des bases de données (fonctions pures). */

export type PropType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "formula"
  | "relation";
export type Option = { id: string; name: string; color: string };
export type Prop = {
  id: string;
  name: string;
  type: PropType;
  options?: Option[];
  /** Formule : expression numérique, les propriétés entre accolades, ex. `{Note} * {Coef} / 20`. */
  formula?: string;
  /** Relation : identifiant de la base dont on référence les lignes. */
  target?: string;
};
export type FilterOp =
  | "contains"
  | "is"
  | "is_not"
  | "empty"
  | "not_empty"
  | "before"
  | "after"
  | "checked"
  | "unchecked";
/** `prop` vaut l'identifiant d'une propriété, ou "title" pour le nom de la ligne. */
export type Filter = { id: string; prop: string; op: FilterOp; value: string };
export type ViewType = "table" | "board" | "calendar" | "list" | "gallery" | "timeline";
export type DbView = {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  sort: { prop: string; dir: "asc" | "desc" } | null;
  /** Propriété « select » qui définit les colonnes d'un kanban. */
  groupBy?: string;
  /** Propriété « date » qui place les lignes dans un calendrier. */
  dateProp?: string;
  /** Chronologie : propriété « date » de fin (facultative). */
  endProp?: string;
};
export type DbConfig = { props: Prop[]; views: DbView[] };
export type Value = string | number | boolean | string[] | null | undefined;
export type Row = {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  props: Record<string, Value>;
  position: number;
  created_at: number;
  updated_at: number;
};

export const OPTION_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export function opsFor(type: PropType | "title"): FilterOp[] {
  switch (type) {
    case "checkbox":
      return ["checked", "unchecked"];
    case "date":
      return ["is", "before", "after", "empty", "not_empty"];
    case "number":
    case "formula":
      return ["is", "is_not", "before", "after", "empty", "not_empty"];
    case "relation":
      return ["empty", "not_empty"];
    case "select":
    case "multi_select":
      return ["is", "is_not", "empty", "not_empty"];
    default:
      return ["contains", "is", "is_not", "empty", "not_empty"];
  }
}

const isEmpty = (v: Value) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

function matches(row: Row, filter: Filter, props: Prop[]): boolean {
  const prop = props.find((p) => p.id === filter.prop);
  if (filter.prop !== "title" && !prop) return true; // propriété supprimée : filtre ignoré
  const value: Value = filter.prop === "title" ? row.title : row.props[filter.prop];
  const type = prop?.type ?? "title";

  switch (filter.op) {
    case "empty":
      return isEmpty(value);
    case "not_empty":
      return !isEmpty(value);
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
  }
  // Un filtre sans valeur saisie ne masque rien.
  if (filter.value === "") return true;

  if (type === "number" || type === "formula") {
    const n = Number(filter.value);
    if (typeof value !== "number") return filter.op === "is_not";
    return filter.op === "is"
      ? value === n
      : filter.op === "is_not"
        ? value !== n
        : filter.op === "before"
          ? value < n
          : value > n;
  }
  if (type === "select" || type === "multi_select") {
    const has = Array.isArray(value) ? value.includes(filter.value) : value === filter.value;
    return filter.op === "is" ? has : !has;
  }
  const text = String(value ?? "");
  switch (filter.op) {
    case "contains":
      return text.toLowerCase().includes(filter.value.toLowerCase());
    case "is":
      return type === "date" ? text === filter.value : text.toLowerCase() === filter.value.toLowerCase();
    case "is_not":
      return text.toLowerCase() !== filter.value.toLowerCase();
    case "before":
      return text !== "" && text < filter.value;
    case "after":
      return text !== "" && text > filter.value;
  }
  return true;
}

function sortKey(row: Row, propId: string, props: Prop[]): string | number | null {
  if (propId === "title") return row.title.toLowerCase();
  const prop = props.find((p) => p.id === propId);
  const value = row.props[propId];
  if (!prop || isEmpty(value)) return prop?.type === "checkbox" ? 0 : null;
  if (prop.type === "checkbox") return value === true ? 1 : 0;
  if (prop.type === "number" || prop.type === "formula") return value as number;
  if (prop.type === "select" || prop.type === "multi_select") {
    const first = Array.isArray(value) ? value[0] : value;
    // Ordre des options tel que défini dans la propriété.
    return prop.options?.findIndex((o) => o.id === first) ?? 0;
  }
  return String(value).toLowerCase();
}

/** Lignes filtrées puis triées selon la vue ; les valeurs vides vont à la fin. */
export function applyView(rows: Row[], view: DbView, props: Prop[]): Row[] {
  const kept = rows.filter((r) => view.filters.every((f) => matches(r, f, props)));
  const sort = view.sort;
  if (!sort) return kept.sort((a, b) => a.position - b.position);
  const dir = sort.dir === "asc" ? 1 : -1;
  return kept.sort((a, b) => {
    const ka = sortKey(a, sort.prop, props);
    const kb = sortKey(b, sort.prop, props);
    if (ka === null || kb === null) return ka === kb ? a.position - b.position : ka === null ? 1 : -1;
    return ka < kb ? -dir : ka > kb ? dir : a.position - b.position;
  });
}

/**
 * Évalue une formule numérique : nombres, + - * /, parenthèses et propriétés
 * entre accolades. Renvoie null si la formule est invalide ou qu'une valeur manque.
 */
export function evalFormula(expression: string, values: Record<string, Value>, props: Prop[]): number | null {
  const tokens = expression.match(/\{[^}]*\}|\d+(?:[.,]\d+)?|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const fail = () => {
    throw new Error("formula");
  };
  const atom = (): number => {
    const tok = tokens[i++];
    if (tok === undefined) return fail();
    if (tok === "(") {
      const v = sum();
      if (tokens[i++] !== ")") fail();
      return v;
    }
    if (tok === "-") return -atom();
    if (tok.startsWith("{")) {
      const name = tok.slice(1, -1).trim().toLowerCase();
      const prop = props.find((p) => p.name.trim().toLowerCase() === name);
      const value = prop && values[prop.id];
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      return fail();
    }
    const n = Number(tok.replace(",", "."));
    return Number.isNaN(n) ? fail() : n;
  };
  const product = (): number => {
    let v = atom();
    while (tokens[i] === "*" || tokens[i] === "/") v = tokens[i++] === "*" ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") v = tokens[i++] === "+" ? v + product() : v - product();
    return v;
  };
  try {
    const result = sum();
    return i === tokens.length && Number.isFinite(result) ? Math.round(result * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

/** Lignes complétées par la valeur calculée de chaque propriété « formule ». */
export function withFormulas(rows: Row[], props: Prop[]): Row[] {
  const formulas = props.filter((p) => p.type === "formula");
  if (formulas.length === 0) return rows;
  return rows.map((row) => {
    const values = { ...row.props };
    // Dans l'ordre des propriétés : une formule peut en utiliser une précédente.
    for (const f of formulas) values[f.id] = evalFormula(f.formula ?? "", values, props);
    return { ...row, props: values };
  });
}
