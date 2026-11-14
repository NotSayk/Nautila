/** Regroupement des lignes d'une base (fonctions pures). */
import { bucketOf, dayPart, parseDateValue, type DateBucket } from "./dbdate";
import { isEmpty, type Option, type Prop, type PropType, type Row, type Value } from "./dbquery";

export type Group = { key: string; option?: Option; rows: Row[] };

/** Types de propriété qui peuvent définir des groupes. */
export const GROUPABLE: PropType[] = ["select", "multi_select", "checkbox", "date", "relation"];

export type GroupOptions = {
  by?: DateBucket;
  weekStart?: 0 | 1;
  /** Garde aussi les groupes vides (une colonne par option). */
  keepEmpty?: boolean;
  /** Place le groupe « sans valeur » avant les autres (kanban). */
  noneFirst?: boolean;
  /** Titre d'une ligne liée ; null si elle n'existe plus. */
  titleOf?: (id: string) => string | null;
};

/** Clés des groupes d'une ligne : une seule, sauf sélection multiple et relation ; "" si aucune valeur. */
export function groupKeys(row: Row, prop: Prop, opts: GroupOptions = {}): string[] {
  const value = row.props[prop.id];
  switch (prop.type) {
    case "checkbox":
      return [value === true ? "true" : "false"];
    case "date": {
      const range = parseDateValue(value);
      return [range ? bucketOf(dayPart(range.start), opts.by ?? "month", opts.weekStart ?? 1) : ""];
    }
    case "relation": {
      const ids = (Array.isArray(value) ? value : []).filter((id) => (opts.titleOf ? opts.titleOf(id) !== null : true));
      return ids.length ? ids : [""];
    }
    default: {
      const ids = (Array.isArray(value) ? value : isEmpty(value) ? [] : [String(value)]).filter((id) =>
        (prop.options ?? []).some((o) => o.id === id),
      );
      return prop.type === "select" ? [ids[0] ?? ""] : ids.length ? ids : [""];
    }
  }
}

/** Lignes réparties en groupes selon une propriété. */
export function groupRows(rows: Row[], prop: Prop, opts: GroupOptions = {}): Group[] {
  const map = new Map<string, Row[]>();
  for (const row of rows)
    for (const key of groupKeys(row, prop, opts)) map.set(key, [...(map.get(key) ?? []), row]);

  let keys: string[];
  if (prop.type === "select" || prop.type === "multi_select") {
    keys = (prop.options ?? []).map((o) => o.id);
  } else if (prop.type === "checkbox") {
    keys = ["true", "false"];
  } else {
    keys = [...map.keys()].filter((k) => k !== "");
    if (prop.type === "date") keys.sort();
    else keys.sort((a, b) => (opts.titleOf?.(a) ?? a).localeCompare(opts.titleOf?.(b) ?? b, undefined, { numeric: true }));
  }
  const groups: Group[] = keys
    .map((key) => ({
      key,
      option: prop.options?.find((o) => o.id === key),
      rows: map.get(key) ?? [],
    }))
    .filter((g) => g.rows.length > 0 || (opts.keepEmpty && (prop.type === "select" || prop.type === "multi_select" || prop.type === "checkbox")));
  const none = map.get("");
  if (none?.length) {
    const group = { key: "", rows: none };
    if (opts.noneFirst) groups.unshift(group);
    else groups.push(group);
  }
  return groups;
}

/** Valeur d'une ligne déplacée d'un groupe à un autre ; undefined si ce type de regroupement ne s'y prête pas. */
export function valueForGroup(prop: Prop, current: Value, from: string, to: string): Value | undefined {
  switch (prop.type) {
    case "select":
      return to || null;
    case "multi_select": {
      const ids = (Array.isArray(current) ? current : []).filter((id) => id !== from && id !== to);
      if (to) ids.push(to);
      return ids.length ? ids : null;
    }
    case "checkbox":
      return to === "true";
    default:
      return undefined;
  }
}
