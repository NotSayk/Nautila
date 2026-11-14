/** Calculs en pied de colonne, rollups et formats de nombres (fonctions pures). */
import { parseDateValue } from "./dbdate";
import { isEmpty, type CalcFn, type Prop, type PropType, type Row, type RollupFn, type Value } from "./dbquery";

const NUMERIC: PropType[] = ["number", "formula", "rollup"];
const DATED: PropType[] = ["date", "created_time", "last_edited_time"];

/** Calculs proposés pour une propriété ("title" : le nom de la ligne). */
export function calcFnsFor(type: PropType | "title"): CalcFn[] {
  if (type === "checkbox") return ["count", "checked", "unchecked", "pct_checked"];
  const general: CalcFn[] = ["count", "values", "unique", "empty", "not_empty", "pct_empty", "pct_not_empty"];
  if (NUMERIC.includes(type as PropType)) return [...general, "sum", "avg", "median", "min", "max", "range"];
  if (DATED.includes(type as PropType)) return [...general, "earliest", "latest"];
  return general;
}

/** `kind` indique comment afficher la valeur : entier, pourcentage, nombre de la propriété ou date. */
export type CalcResult = { kind: "int" | "percent" | "number" | "date"; value: number | string };

/** Résultat d'un calcul sur les valeurs d'une colonne (une par ligne) ; null s'il n'y a rien à afficher. */
export function computeCalc(fn: CalcFn, values: Value[]): CalcResult | null {
  const total = values.length;
  const filled = values.filter((v) => !isEmpty(v));
  const percent = (n: number): CalcResult => ({ kind: "percent", value: total ? (n / total) * 100 : 0 });
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  switch (fn) {
    case "count":
      return { kind: "int", value: total };
    case "values":
      return { kind: "int", value: filled.length };
    case "unique":
      return { kind: "int", value: new Set(filled.map((v) => JSON.stringify(v))).size };
    case "empty":
      return { kind: "int", value: total - filled.length };
    case "not_empty":
      return { kind: "int", value: filled.length };
    case "pct_empty":
      return percent(total - filled.length);
    case "pct_not_empty":
      return percent(filled.length);
    case "checked":
      return { kind: "int", value: values.filter((v) => v === true).length };
    case "unchecked":
      return { kind: "int", value: values.filter((v) => v !== true).length };
    case "pct_checked":
      return percent(values.filter((v) => v === true).length);
    case "sum":
      return { kind: "number", value: nums.reduce((s, n) => s + n, 0) };
    case "avg":
      return nums.length ? { kind: "number", value: nums.reduce((s, n) => s + n, 0) / nums.length } : null;
    case "median": {
      if (!nums.length) return null;
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return { kind: "number", value: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 };
    }
    case "min":
      return nums.length ? { kind: "number", value: Math.min(...nums) } : null;
    case "max":
      return nums.length ? { kind: "number", value: Math.max(...nums) } : null;
    case "range":
      return nums.length ? { kind: "number", value: Math.max(...nums) - Math.min(...nums) } : null;
    case "earliest":
    case "latest": {
      const starts = values.flatMap((v) => parseDateValue(v)?.start ?? []).sort();
      if (!starts.length) return null;
      return { kind: "date", value: fn === "earliest" ? starts[0] : starts[starts.length - 1] };
    }
  }
}

/** Nombre mis en forme selon la propriété (format, décimales) ; sans réglage, le nombre tel quel. */
export function formatNumber(n: number, prop: Pick<Prop, "format" | "decimals"> | undefined, lang: string): string {
  const decimals = prop?.decimals;
  const digits =
    decimals != null
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 6 };
  switch (prop?.format) {
    case "percent":
      return `${new Intl.NumberFormat(lang, { ...digits, useGrouping: false }).format(n)} %`;
    case "eur":
    case "usd":
      return new Intl.NumberFormat(lang, {
        style: "currency",
        currency: prop.format === "eur" ? "EUR" : "USD",
        ...(decimals != null ? digits : {}),
      }).format(n);
    default:
      return decimals != null
        ? new Intl.NumberFormat(lang, { ...digits, useGrouping: false }).format(n)
        : String(Math.round(n * 1e6) / 1e6);
  }
}

/** Contenu d'une base liée, tel que le lisent les rollups. */
export type RelatedBase = { props: Prop[]; rows: Row[] };

/** Bases dont les rollups de ces propriétés ont besoin. */
export function rollupTargets(props: Prop[]): string[] {
  const ids = props
    .filter((p) => p.type === "rollup")
    .flatMap((p) => props.find((r) => r.id === p.rollupRelation && r.type === "relation")?.target ?? []);
  return [...new Set(ids)];
}

function listed(value: Value, prop: Prop | undefined): string[] {
  if (isEmpty(value)) return [];
  const ids = Array.isArray(value) ? value : [value];
  return ids.map((v) => {
    if (prop?.type === "select" || prop?.type === "multi_select")
      return prop.options?.find((o) => o.id === v)?.name ?? "";
    if (v === true) return "✓";
    return typeof v === "number" ? formatNumber(v, prop, "en") : String(v);
  }).filter(Boolean);
}

/** Valeur d'un rollup pour une ligne : agrégation d'une propriété des lignes liées. */
export function rollupValue(prop: Prop, row: Row, props: Prop[], related: Map<string, RelatedBase>): number | string | null {
  const relation = props.find((p) => p.id === prop.rollupRelation && p.type === "relation");
  const base = relation?.target ? related.get(relation.target) : undefined;
  if (!relation || !base) return null;
  const ids = Array.isArray(row.props[relation.id]) ? (row.props[relation.id] as string[]) : [];
  const linked = ids.flatMap((id) => base.rows.find((r) => r.id === id) ?? []);
  const fn: RollupFn = prop.rollupFn ?? "count";
  if (fn === "count") return linked.length;
  const source = base.props.find((p) => p.id === prop.rollupProp);
  const values = linked.map((r) => (prop.rollupProp === "title" ? r.title : r.props[prop.rollupProp ?? ""]));
  if (fn === "list") return [...new Set(values.flatMap((v) => listed(v, source)))].join(", ") || null;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return fn === "sum" ? 0 : null;
  const total = nums.reduce((s, n) => s + n, 0);
  const result =
    fn === "sum" ? total : fn === "avg" ? total / nums.length : fn === "min" ? Math.min(...nums) : Math.max(...nums);
  return Math.round(result * 1e6) / 1e6;
}

/** Lignes complétées par la valeur de chaque propriété « rollup ». */
export function withRollups(rows: Row[], props: Prop[], related: Map<string, RelatedBase>): Row[] {
  const rollups = props.filter((p) => p.type === "rollup");
  if (rollups.length === 0) return rows;
  return rows.map((row) => {
    const values = { ...row.props };
    for (const p of rollups) values[p.id] = rollupValue(p, row, props, related);
    return { ...row, props: values };
  });
}
