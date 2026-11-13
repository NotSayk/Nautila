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
  if (prop.type === "number") return value as number;
  if (prop.type === "formula") return typeof value === "number" ? value : String(value).toLowerCase();
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

type FormulaValue = number | string | boolean;

const FORMULA_FUNCTIONS: Record<string, (args: FormulaValue[]) => FormulaValue> = {
  if: ([condition, yes, no]) => (condition ? yes : no),
  round: ([x, digits = 0]) => {
    const factor = 10 ** Number(digits);
    return Math.round(Number(x) * factor) / factor;
  },
  abs: ([x]) => Math.abs(Number(x)),
  min: (args) => Math.min(...args.map(Number)),
  max: (args) => Math.max(...args.map(Number)),
  concat: (args) => args.map(String).join(""),
  length: ([text]) => String(text).length,
  upper: ([text]) => String(text).toUpperCase(),
  lower: ([text]) => String(text).toLowerCase(),
  today: () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },
  // Nombre de jours de la première date à la seconde.
  days: ([from, to]) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000),
};

/** Découpe une formule ; dans les arguments d'une fonction, la virgule sépare au lieu de servir de décimale. */
function formulaTokens(expression: string): string[] {
  const tokens: string[] = [];
  const parens: boolean[] = []; // vrai pour une parenthèse ouverte par un appel de fonction
  const pattern = /\{[^}]*\}|"[^"]*"|\d+(?:\.\d+)?|[A-Za-z_]+|==|!=|>=|<=|\S/g;
  for (let match = pattern.exec(expression); match; match = pattern.exec(expression)) {
    let token = match[0];
    const previous = tokens[tokens.length - 1];
    if (token === "(") parens.push(/^[A-Za-z_]+$/.test(previous ?? ""));
    else if (token === ")") parens.pop();
    else if (token === "," && !parens[parens.length - 1] && /^\d+$/.test(previous ?? "")) {
      // « 1,5 » hors d'un appel de fonction : virgule décimale.
      const decimals = /^\d+/.exec(expression.slice(pattern.lastIndex))?.[0];
      if (decimals) {
        pattern.lastIndex += decimals.length;
        tokens[tokens.length - 1] = `${previous}.${decimals}`;
        continue;
      }
    } else if (token === ";") token = ",";
    tokens.push(token);
  }
  return tokens;
}

/**
 * Évalue une formule : nombres, textes entre guillemets, propriétés entre
 * accolades, + - * /, comparaisons et quelques fonctions (if, round, concat,
 * days, today…). Renvoie null si elle est invalide ou qu'une valeur manque.
 */
export function evalFormula(expression: string, values: Record<string, Value>, props: Prop[]): number | string | null {
  const tokens = formulaTokens(expression);
  let i = 0;
  const fail = (): never => {
    throw new Error("formula");
  };
  const num = (v: FormulaValue): number => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : fail());

  const atom = (): FormulaValue => {
    const tok = tokens[i++];
    if (tok === undefined) return fail();
    if (tok === "(") {
      const v = comparison();
      if (tokens[i++] !== ")") fail();
      return v;
    }
    if (tok === "-") return -num(atom());
    if (tok.startsWith('"')) return tok.slice(1, -1);
    if (tok.startsWith("{")) {
      const name = tok.slice(1, -1).trim().toLowerCase();
      const prop = props.find((p) => p.name.trim().toLowerCase() === name);
      const value = prop && values[prop.id];
      if (prop?.type === "checkbox") return value === true;
      if (typeof value === "number" || (typeof value === "string" && value !== "")) return value;
      return fail();
    }
    if (/^[A-Za-z_]+$/.test(tok)) {
      const fn = FORMULA_FUNCTIONS[tok.toLowerCase()];
      if (!fn || tokens[i++] !== "(") return fail();
      const args: FormulaValue[] = [];
      while (tokens[i] !== ")") {
        args.push(comparison());
        if (tokens[i] === ",") i++;
        else if (tokens[i] !== ")") fail();
      }
      i++;
      return fn(args);
    }
    const n = Number(tok);
    return Number.isNaN(n) ? fail() : n;
  };
  const product = (): FormulaValue => {
    let v = atom();
    while (tokens[i] === "*" || tokens[i] === "/")
      v = tokens[i++] === "*" ? num(v) * num(atom()) : num(v) / num(atom());
    return v;
  };
  const sum = (): FormulaValue => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const plus = tokens[i++] === "+";
      const right = product();
      // « + » colle deux textes ; avec deux nombres, il additionne.
      v =
        plus && (typeof v === "string" || typeof right === "string")
          ? String(v) + String(right)
          : plus
            ? num(v) + num(right)
            : num(v) - num(right);
    }
    return v;
  };
  const comparison = (): FormulaValue => {
    const left = sum();
    const op = tokens[i];
    if (!["==", "!=", ">", "<", ">=", "<="].includes(op)) return left;
    i++;
    const right = sum();
    switch (op) {
      case "==":
        return left === right;
      case "!=":
        return left !== right;
      case ">":
        return left > right;
      case "<":
        return left < right;
      case ">=":
        return left >= right;
      default:
        return left <= right;
    }
  };

  try {
    const result = comparison();
    if (i !== tokens.length) return null;
    if (typeof result === "string") return result;
    const n = Number(result);
    return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
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
