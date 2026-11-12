/** Modèle et requêtes des bases de données (fonctions pures). */

export type PropType = "text" | "number" | "select" | "multi_select" | "date" | "checkbox" | "url";
export type Option = { id: string; name: string; color: string };
export type Prop = { id: string; name: string; type: PropType; options?: Option[] };
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
export type ViewType = "table" | "board" | "calendar" | "list" | "gallery";
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
      return ["is", "is_not", "before", "after", "empty", "not_empty"];
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

  if (type === "number") {
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
