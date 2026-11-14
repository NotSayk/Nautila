/** Changement de type d'une propriété, avec conversion des valeurs existantes (fonctions pures). */
import { isoDay, parseDateValue, validDate } from "./dbdate";
import { isEmpty, OPTION_COLORS, type Option, type Prop, type PropType, type Value } from "./dbquery";

const TEXTY: PropType[] = ["text", "url", "email", "phone"];

/** Types vers lesquels on peut convertir une propriété sans perdre de sens. */
export function convertTargets(type: PropType): PropType[] {
  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return [...TEXTY.filter((t) => t !== type), "number", "select", "multi_select", "date", "checkbox"];
    case "number":
      return ["text", "select", "multi_select"];
    case "select":
      return ["text", "multi_select"];
    case "multi_select":
      return ["text", "select"];
    case "date":
      return ["text"];
    case "checkbox":
      return ["text"];
    case "formula":
    case "rollup":
      return ["text", "number"];
    case "created_time":
    case "last_edited_time":
      return ["text", "date"];
    default:
      return [];
  }
}

/** Texte d'une valeur : noms des options, nombre, date… */
function toText(value: Value, from: Prop): string {
  if (isEmpty(value)) return "";
  if (from.type === "select" || from.type === "multi_select") {
    const ids = Array.isArray(value) ? value : [String(value)];
    return ids.map((id) => from.options?.find((o) => o.id === id)?.name ?? "").filter(Boolean).join(", ");
  }
  if (from.type === "checkbox") return value === true ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function toDate(text: string): string | null {
  const t = text.trim();
  if (parseDateValue(t)) return t;
  // « 31/12/2026 » (jour d'abord), sinon ce que sait lire le navigateur.
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (fr) {
    const iso = `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
    return validDate(iso) ? iso : null;
  }
  if (!/\d{4}/.test(t)) return null;
  const time = Date.parse(t);
  return Number.isNaN(time) ? null : isoDay(new Date(time));
}

/**
 * Convertit les valeurs d'une colonne vers un autre type. Renvoie la propriété transformée
 * (avec les options créées au besoin) et la nouvelle valeur de chaque ligne ; null quand
 * la valeur n'a pas de sens dans le nouveau type.
 */
export function convertColumn(
  cells: { id: string; value: Value }[],
  from: Prop,
  to: PropType,
  newId: () => string = () => crypto.randomUUID().slice(0, 8),
): { prop: Prop; values: Map<string, Value> } {
  const prop: Prop = { id: from.id, name: from.name, type: to };
  const values = new Map<string, Value>();
  const sameOptions = (from.type === "select" || from.type === "multi_select") && (to === "select" || to === "multi_select");

  if (sameOptions) {
    prop.options = from.options;
    for (const { id, value } of cells) {
      const ids = Array.isArray(value) ? value : isEmpty(value) ? [] : [String(value)];
      values.set(id, ids.length === 0 ? null : to === "multi_select" ? ids : ids[0]);
    }
    return { prop, values };
  }

  if (to === "select" || to === "multi_select") {
    const options: Option[] = [];
    const optionFor = (name: string): string => {
      const found = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      const option = { id: newId(), name, color: OPTION_COLORS[options.length % OPTION_COLORS.length] };
      options.push(option);
      return option.id;
    };
    for (const { id, value } of cells) {
      const text = toText(value, from);
      const parts = (to === "multi_select" ? text.split(/[,;]/) : [text]).map((p) => p.trim()).filter(Boolean);
      const ids = parts.map(optionFor);
      values.set(id, ids.length === 0 ? null : to === "multi_select" ? ids : ids[0]);
    }
    prop.options = options;
    return { prop, values };
  }

  for (const { id, value } of cells) {
    const text = toText(value, from).trim();
    let next: Value = null;
    if (text !== "") {
      if (to === "number") {
        const n = typeof value === "number" ? value : Number(text.replace(",", "."));
        next = Number.isFinite(n) ? n : null;
      } else if (to === "checkbox") next = value === true || /^(yes|true|oui|1|x|✓)$/i.test(text);
      else if (to === "date") next = toDate(text);
      else next = text;
    } else if (to === "checkbox") next = false;
    values.set(id, next);
  }
  return { prop, values };
}
