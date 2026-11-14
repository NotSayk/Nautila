/** Modèle et requêtes des bases de données (fonctions pures). */
import {
  dayPart,
  isoDay,
  isoMinute,
  parseDateValue,
  relativeRange,
  validDate,
  type DateBucket,
} from "./dbdate";
import { evalFormula } from "./dbformula";

export { evalFormula, formulaIssue, FORMULA_FUNCTION_NAMES, type FormulaIssue } from "./dbformula";

export type PropType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "files"
  | "created_time"
  | "last_edited_time"
  | "formula"
  | "relation"
  | "rollup";
export type Option = { id: string; name: string; color: string };
export type NumberFormat = "number" | "percent" | "eur" | "usd";
export type RollupFn = "count" | "sum" | "avg" | "min" | "max" | "list";
/**
 * Les champs facultatifs sont ignorés par les versions plus anciennes de l'application :
 * une propriété d'un type inconnu s'y affiche comme du texte.
 */
export type Prop = {
  id: string;
  name: string;
  type: PropType;
  options?: Option[];
  /** Formule : expression numérique, les propriétés entre accolades, ex. `{Note} * {Coef} / 20`. */
  formula?: string;
  /** Relation : identifiant de la base dont on référence les lignes. */
  target?: string;
  /** Relation bidirectionnelle : identifiant de la propriété miroir dans la base liée. */
  twin?: string;
  /** Nombre : format d'affichage et nombre de décimales (la valeur stockée reste le nombre saisi). */
  format?: NumberFormat;
  decimals?: number;
  /** Rollup : relation de cette base, propriété (ou "title") de la base liée, et agrégation. */
  rollupRelation?: string;
  rollupProp?: string;
  rollupFn?: RollupFn;
};
export type FilterOp =
  | "contains"
  | "not_contains"
  | "is"
  | "is_not"
  | "empty"
  | "not_empty"
  | "starts_with"
  | "ends_with"
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "between"
  | "relative"
  | "checked"
  | "unchecked";
/**
 * `prop` vaut l'identifiant d'une propriété, ou "title" pour le nom de la ligne.
 * Un groupe (`group`) combine ses conditions en ET ou en OU (`mode`) ; son `prop` est vide,
 * ce qui le fait ignorer par les versions qui ne connaissent pas les groupes.
 */
export type Filter = {
  id: string;
  prop: string;
  op: FilterOp;
  value: string;
  /** Deuxième borne de « entre ». */
  value2?: string;
  mode?: "and" | "or";
  group?: Filter[];
};
export type ViewType = "table" | "board" | "calendar" | "list" | "gallery" | "timeline";
export type Sort = { prop: string; dir: "asc" | "desc" };
export type CalcFn =
  | "count"
  | "values"
  | "unique"
  | "empty"
  | "not_empty"
  | "pct_empty"
  | "pct_not_empty"
  | "sum"
  | "avg"
  | "median"
  | "min"
  | "max"
  | "range"
  | "earliest"
  | "latest"
  | "checked"
  | "unchecked"
  | "pct_checked";
export type DbView = {
  id: string;
  name: string;
  type: ViewType;
  filters: Filter[];
  /** Premier tri, lu par les anciennes versions ; `sorts` porte la liste complète. */
  sort: Sort | null;
  sorts?: Sort[];
  /** Combinaison des filtres de premier niveau (ET par défaut). */
  filterMode?: "and" | "or";
  /** Propriété qui définit les groupes (colonnes d'un kanban, sections ailleurs). */
  groupBy?: string;
  /** Regroupement par date : par jour, semaine, mois ou année (mois par défaut). */
  groupDate?: DateBucket;
  /** Groupes repliés. */
  collapsed?: string[];
  /** Masque les groupes vides (kanban). */
  hideEmptyGroups?: boolean;
  /** Propriété « date » qui place les lignes dans un calendrier. */
  dateProp?: string;
  /** Chronologie : propriété « date » de fin (facultative). */
  endProp?: string;
  /** Chronologie : échelle. */
  zoom?: "day" | "week" | "month";
  /** Largeur des colonnes du tableau en pixels, par identifiant de propriété ("title" pour le nom). */
  widths?: Record<string, number>;
  /** Ordre des propriétés ; celles qui n'y figurent pas viennent ensuite. */
  order?: string[];
  /** Propriétés masquées dans la vue (colonnes, cartes). */
  hidden?: string[];
  /** Calcul affiché en pied de chaque colonne du tableau. */
  calcs?: Record<string, CalcFn>;
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

/** Propriétés calculées à partir de la ligne ou d'autres bases : jamais enregistrées dans les valeurs de la ligne. */
export const isComputed = (type: PropType) =>
  type === "formula" || type === "rollup" || type === "created_time" || type === "last_edited_time";

const NUMBER_OPS: FilterOp[] = ["eq", "neq", "lt", "lte", "gt", "gte", "empty", "not_empty"];
const TEXT_OPS: FilterOp[] = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
];
const DATE_OPS: FilterOp[] = [
  "is",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "between",
  "relative",
  "empty",
  "not_empty",
];

export function opsFor(type: PropType | "title"): FilterOp[] {
  switch (type) {
    case "checkbox":
      return ["checked", "unchecked"];
    case "date":
    case "created_time":
    case "last_edited_time":
      return DATE_OPS;
    case "number":
      return NUMBER_OPS;
    case "formula":
    case "rollup":
      return ["eq", "neq", "lt", "lte", "gt", "gte", "contains", "not_contains", "empty", "not_empty"];
    case "relation":
      return ["contains", "not_contains", "empty", "not_empty"];
    case "files":
      return ["empty", "not_empty"];
    case "select":
      return ["is", "is_not", "empty", "not_empty"];
    case "multi_select":
      return ["contains", "not_contains", "empty", "not_empty"];
    default:
      return TEXT_OPS;
  }
}

/** Opérateurs qui n'attendent aucune valeur. */
export const valueless = (op: FilterOp) => ["empty", "not_empty", "checked", "unchecked"].includes(op);

export const isEmpty = (v: Value) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** Contexte des filtres relatifs : « aujourd'hui » et premier jour de la semaine. */
export type QueryCtx = { now?: Date; weekStart?: 0 | 1 };

/** Valeur d'une propriété pour une ligne ; les dates de création et de modification viennent de la page. */
export function cellValue(row: Row, prop: Prop | undefined | "title"): Value {
  if (prop === "title") return row.title;
  if (!prop) return undefined;
  if (prop.type === "created_time") return isoMinute(new Date(row.created_at));
  if (prop.type === "last_edited_time") return isoMinute(new Date(row.updated_at));
  return row.props[prop.id];
}

const lower = (v: unknown) => String(v ?? "").toLowerCase();

function numericMatch(op: FilterOp, value: number | null, n: number): boolean {
  if (value === null) return op === "neq" || op === "is_not";
  switch (op) {
    case "eq":
    case "is":
      return value === n;
    case "neq":
    case "is_not":
      return value !== n;
    case "lt":
    case "before":
      return value < n;
    case "lte":
      return value <= n;
    case "gt":
    case "after":
      return value > n;
    case "gte":
      return value >= n;
  }
  return true;
}

function dateMatch(f: Filter, value: Value, ctx: QueryCtx): boolean | null {
  const range = parseDateValue(value);
  const wanted = f.value;
  if (f.op === "relative") {
    const period = relativeRange(f.value, isoDay(ctx.now ?? new Date()), ctx.weekStart ?? 1);
    if (!period) return null;
    if (!range) return false;
    return dayPart(range.start) <= period[1] && dayPart(range.end ?? range.start) >= period[0];
  }
  if (f.op === "between") {
    if (!validDate(wanted) || !validDate(f.value2 ?? "")) return null;
    const [lo, hi] = wanted <= f.value2! ? [wanted, f.value2!] : [f.value2!, wanted];
    return !!range && dayPart(range.start) <= hi && dayPart(range.end ?? range.start) >= lo;
  }
  if (!validDate(wanted)) return null;
  if (!range) return f.op === "is_not";
  const start = dayPart(range.start);
  const end = dayPart(range.end ?? range.start);
  switch (f.op) {
    case "is":
      return start <= wanted && wanted <= end;
    case "is_not":
      return !(start <= wanted && wanted <= end);
    case "before":
      return start < wanted;
    case "after":
      return end > wanted;
    case "on_or_before":
      return start <= wanted;
    case "on_or_after":
      return end >= wanted;
  }
  return null;
}

/** Vrai ou faux ; null quand le filtre est incomplet ou vise une propriété supprimée, et ne masque donc rien. */
function evalFilter(row: Row, filter: Filter, props: Prop[], ctx: QueryCtx): boolean | null {
  if (filter.group) return combine(filter.group.map((f) => evalFilter(row, f, props, ctx)), filter.mode);
  const prop = props.find((p) => p.id === filter.prop);
  if (filter.prop !== "title" && !prop) return null; // propriété supprimée : filtre ignoré
  const value = cellValue(row, filter.prop === "title" ? "title" : prop);
  const type = prop?.type ?? "title";
  const op = filter.op;

  switch (op) {
    case "empty":
      return isEmpty(value);
    case "not_empty":
      return !isEmpty(value);
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
  }
  // Un filtre sans valeur saisie ne masque rien (sauf les périodes relatives, dont la valeur est un choix).
  if (filter.value === "" && op !== "between") return null;

  if (type === "date" || type === "created_time" || type === "last_edited_time") return dateMatch(filter, value, ctx);

  if (type === "number" || type === "formula" || type === "rollup") {
    const isNumberOp = ["eq", "neq", "lt", "lte", "gt", "gte", "is", "is_not", "before", "after"].includes(op);
    if (isNumberOp && (type === "number" || typeof value === "number" || value == null)) {
      const n = Number(filter.value.replace(",", "."));
      // Tant que la valeur saisie n'est pas un nombre, le filtre ne masque rien.
      if (Number.isNaN(n)) return null;
      return numericMatch(op, typeof value === "number" ? value : null, n);
    }
  }
  if (type === "select" || type === "multi_select") {
    const has = Array.isArray(value) ? value.includes(filter.value) : value === filter.value;
    return op === "is" || op === "contains" ? has : !has;
  }
  if (type === "relation") {
    const has = Array.isArray(value) && value.includes(filter.value);
    return op === "not_contains" || op === "is_not" ? !has : has;
  }
  const text = lower(Array.isArray(value) ? value.join(", ") : value);
  const wanted = filter.value.toLowerCase();
  switch (op) {
    case "contains":
      return text.includes(wanted);
    case "not_contains":
      return !text.includes(wanted);
    case "is":
    case "eq":
      return text === wanted;
    case "is_not":
    case "neq":
      return text !== wanted;
    case "starts_with":
      return text.startsWith(wanted);
    case "ends_with":
      return text.endsWith(wanted);
    case "before":
    case "lt":
      return text !== "" && text < wanted;
    case "after":
    case "gt":
      return text !== "" && text > wanted;
  }
  return null;
}

function combine(results: (boolean | null)[], mode?: "and" | "or"): boolean | null {
  const known = results.filter((r): r is boolean => r !== null);
  if (known.length === 0) return null;
  return mode === "or" ? known.some(Boolean) : known.every(Boolean);
}

/** Tris de la vue, dans l'ordre ; lit l'ancien tri unique tant que la liste complète n'existe pas ou lui est étrangère. */
export function viewSorts(view: Pick<DbView, "sort" | "sorts">): Sort[] {
  const { sorts, sort } = view;
  if (sorts?.length && sort && sorts[0].prop === sort.prop && sorts[0].dir === sort.dir) return sorts;
  return sort ? [sort] : [];
}

/** Vue avec ces tris (le premier est aussi écrit dans `sort` pour les anciennes versions). */
export function withSorts(view: DbView, sorts: Sort[]): DbView {
  const next: DbView = { ...view, sort: sorts[0] ?? null };
  if (sorts.length > 1) next.sorts = sorts;
  else delete next.sorts;
  return next;
}

function sortKey(row: Row, propId: string, props: Prop[]): string | number | null {
  if (propId === "title") return row.title.toLowerCase();
  const prop = props.find((p) => p.id === propId);
  if (prop?.type === "created_time") return row.created_at;
  if (prop?.type === "last_edited_time") return row.updated_at;
  const value = row.props[propId];
  if (!prop || isEmpty(value)) return prop?.type === "checkbox" ? 0 : null;
  if (prop.type === "checkbox") return value === true ? 1 : 0;
  if (prop.type === "number") return value as number;
  if (prop.type === "formula" || prop.type === "rollup")
    return typeof value === "number" ? value : String(value).toLowerCase();
  if (prop.type === "select" || prop.type === "multi_select") {
    const first = Array.isArray(value) ? value[0] : value;
    // Ordre des options tel que défini dans la propriété.
    const at = prop.options?.findIndex((o) => o.id === first) ?? -1;
    return at < 0 ? null : at;
  }
  if (prop.type === "date") return parseDateValue(value)?.start ?? null;
  if (prop.type === "relation" || prop.type === "files") return Array.isArray(value) ? value.length : 0;
  return String(value).toLowerCase();
}

/** Lignes filtrées puis triées selon la vue ; les valeurs vides vont à la fin. */
export function applyView(rows: Row[], view: DbView, props: Prop[], ctx: QueryCtx = {}): Row[] {
  const kept = rows.filter((r) => combine(view.filters.map((f) => evalFilter(r, f, props, ctx)), view.filterMode) !== false);
  const sorts = viewSorts(view).filter((s) => s.prop === "title" || props.some((p) => p.id === s.prop));
  if (sorts.length === 0) return kept.sort((a, b) => a.position - b.position);
  return kept.sort((a, b) => {
    for (const sort of sorts) {
      const ka = sortKey(a, sort.prop, props);
      const kb = sortKey(b, sort.prop, props);
      if (ka === null || kb === null) {
        if (ka === kb) continue;
        return ka === null ? 1 : -1;
      }
      const c = compareKeys(ka, kb);
      if (c !== 0) return c * (sort.dir === "asc" ? 1 : -1);
    }
    return a.position - b.position;
  });
}

/** Recherche rapide : garde les lignes dont le nom ou une propriété textuelle (ou le nom d'une option) contient la requête. */
export function searchRows(rows: Row[], query: string, props: Prop[]): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    if (row.title.toLowerCase().includes(q)) return true;
    return props.some((p) => {
      const value = row.props[p.id];
      if (isEmpty(value)) return false;
      if (p.type === "select" || p.type === "multi_select") {
        const ids = Array.isArray(value) ? value : [String(value)];
        return ids.some((id) => p.options?.find((o) => o.id === id)?.name.toLowerCase().includes(q));
      }
      if (["text", "url", "email", "phone", "number", "formula", "rollup"].includes(p.type))
        return String(value).toLowerCase().includes(q);
      return false;
    });
  });
}

/** Nombres avant textes ; textes comparés selon la langue (accents, nombres dans le texte). */
function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Groupe d'une ligne pour une propriété « sélection » : "" (aucune valeur) si elle est vide ou ne correspond à aucune option. */
export function groupKey(value: Value, prop: Prop): string {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === "string" && (prop.options ?? []).some((o) => o.id === id) ? id : "";
}

/** Valeurs d'une ligne sans les options supprimées d'une propriété ; null si rien ne change. */
export function stripOptions(
  props: Record<string, Value>,
  propId: string,
  removed: string[],
): Record<string, Value> | null {
  const value = props[propId];
  if (Array.isArray(value)) {
    const kept = value.filter((id) => !removed.includes(id));
    return kept.length === value.length ? null : { ...props, [propId]: kept.length ? kept : null };
  }
  return typeof value === "string" && removed.includes(value) ? { ...props, [propId]: null } : null;
}

function cleanFilters(filters: Filter[], propId: string): Filter[] {
  return filters.flatMap((f) => {
    if (f.group) {
      const group = cleanFilters(f.group, propId);
      return group.length ? [{ ...f, group }] : [];
    }
    return f.prop === propId ? [] : [f];
  });
}

/** Configuration sans la propriété : les filtres, tris, regroupement, dates et réglages des vues qui s'y référaient sont nettoyés. */
export function removeProp(config: DbConfig, propId: string): DbConfig {
  const without = <T,>(map: Record<string, T> | undefined) => {
    if (!map || !(propId in map)) return map;
    const { [propId]: _gone, ...rest } = map;
    return rest;
  };
  return {
    props: config.props.filter((p) => p.id !== propId),
    views: config.views.map((v) => {
      const sorts = viewSorts(v).filter((s) => s.prop !== propId);
      const next: DbView = { ...withSorts(v, sorts), filters: cleanFilters(v.filters, propId) };
      if (v.groupBy === propId) {
        delete next.groupBy;
        delete next.collapsed;
      }
      if (v.dateProp === propId) delete next.dateProp;
      if (v.endProp === propId) delete next.endProp;
      if (v.order) next.order = v.order.filter((id) => id !== propId);
      if (v.hidden) next.hidden = v.hidden.filter((id) => id !== propId);
      if (v.widths) next.widths = without(v.widths);
      if (v.calcs) next.calcs = without(v.calcs);
      return next;
    }),
  };
}

/** Propriétés dans l'ordre de la vue : celles de `view.order`, puis les autres dans leur ordre d'origine. */
export function orderedProps(props: Prop[], view: Pick<DbView, "order">): Prop[] {
  const order = view.order ?? [];
  const known = order.flatMap((id) => props.find((p) => p.id === id) ?? []);
  return [...known, ...props.filter((p) => !order.includes(p.id))];
}

/** Propriétés affichées par la vue, dans son ordre. */
export function visibleProps(props: Prop[], view: Pick<DbView, "order" | "hidden">): Prop[] {
  const hidden = view.hidden ?? [];
  return orderedProps(props, view).filter((p) => !hidden.includes(p.id));
}

/** Nouvelle `position` pour placer `movingId` avant `beforeId` (à la fin si null), d'après l'ordre des lignes affichées. */
export function positionBefore(rows: Row[], movingId: string, beforeId: string | null): number | null {
  const list = rows.filter((r) => r.id !== movingId);
  if (beforeId === null) return list.length ? Math.max(...list.map((r) => r.position)) + 1 : null;
  const at = list.findIndex((r) => r.id === beforeId);
  if (at < 0) return null;
  const next = list[at].position;
  return at === 0 ? next - 1 : (list[at - 1].position + next) / 2;
}

/** Jour « AAAA-MM-JJ » en millisecondes à midi, ou null si la date est invalide. */
export function dayNoon(isoDate: unknown): number | null {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const t = new Date(`${isoDate}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

const DAY = 86_400_000;
/** Plage de la frise : toutes les lignes avec une marge, au moins cinq semaines, bornée à `maxDays` autour d'aujourd'hui. */
export function timelineBounds(items: { start: number; end: number }[], today: number, maxDays = 730) {
  let from = Math.min(today, ...items.map((i) => i.start)) - 3 * DAY;
  let to = Math.max(from + 35 * DAY, ...items.map((i) => i.end + 7 * DAY));
  if ((to - from) / DAY > maxDays) {
    from = today - 30 * DAY;
    to = from + maxDays * DAY;
  }
  return { from, to };
}

/** Lignes complétées par les valeurs calculées sans autre base : formules, dates de création et de modification. */
export function withFormulas(rows: Row[], props: Prop[]): Row[] {
  const computed = props.filter((p) => p.type === "formula" || p.type === "created_time" || p.type === "last_edited_time");
  if (computed.length === 0) return rows;
  return rows.map((row) => {
    const values = { ...row.props };
    // Dans l'ordre des propriétés : une formule peut en utiliser une précédente.
    for (const p of computed)
      values[p.id] = p.type === "formula" ? evalFormula(p.formula ?? "", values, props) : cellValue(row, p);
    return { ...row, props: values };
  });
}

/** Valeurs d'une ligne prêtes à être enregistrées : sans les résultats calculés. */
export function storedValues(values: Record<string, Value>, props: Prop[]): Record<string, Value> {
  const stored = { ...values };
  for (const p of props) if (isComputed(p.type)) delete stored[p.id];
  return stored;
}
