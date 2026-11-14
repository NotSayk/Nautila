/** Formules des bases de données : lecture, évaluation et diagnostic (fonctions pures). */
import { dayDiff, dayPart, isoDay, isoMinute, parseDateValue, validDate } from "./dbdate";
import type { Prop, Value } from "./dbquery";

type FormulaValue = number | string | boolean;

/** Cause d'une formule invalide ; `detail` complète le message affiché (nom de fonction, de propriété…). */
export type FormulaIssue = {
  code: "syntax" | "unclosed" | "unknownFunction" | "unknownProp" | "argCount" | "type" | "divZero";
  detail: string;
};

class FormulaError extends Error {
  constructor(readonly issue: FormulaIssue) {
    super(issue.code);
  }
}
const fail = (code: FormulaIssue["code"], detail = ""): never => {
  throw new FormulaError({ code, detail });
};

const num = (v: FormulaValue, where: string): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return Number(v);
  return fail("type", where);
};
const text = (v: FormulaValue): string => (typeof v === "boolean" ? (v ? "true" : "false") : String(v));
const day = (v: FormulaValue, where: string): string => {
  const s = typeof v === "string" ? dayPart(v.split("/")[0]) : "";
  return validDate(s) ? s : fail("type", where);
};

function addToDate(value: string, n: number, unit: string): string {
  const base = value.split("/")[0];
  if (!validDate(base)) return fail("type", "dateAdd");
  const hasTime = base.length > 10;
  const d = new Date(hasTime ? `${base}:00` : `${base}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fail("type", "dateAdd");
  const u = unit.toLowerCase();
  if (["day", "days", "jour", "jours"].includes(u)) d.setDate(d.getDate() + n);
  else if (["week", "weeks", "semaine", "semaines"].includes(u)) d.setDate(d.getDate() + 7 * n);
  else if (["month", "months", "mois"].includes(u) || ["year", "years", "an", "ans", "annee", "annees"].includes(u)) {
    const months = ["year", "years", "an", "ans", "annee", "annees"].includes(u) ? 12 * n : n;
    const dom = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // « 31 janvier + 1 mois » tombe le dernier jour de février, pas début mars.
    d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  } else if (["hour", "hours", "heure", "heures"].includes(u)) d.setHours(d.getHours() + n);
  else if (["minute", "minutes"].includes(u)) d.setMinutes(d.getMinutes() + n);
  else return fail("type", "dateAdd");
  const timed = hasTime || /^(hour|heure|minute)/.test(u);
  return timed ? isoMinute(d) : isoDay(d);
}

function formatWith(value: string, pattern: string): string {
  const s = value.split("/")[0];
  if (!validDate(s)) return fail("type", "formatDate");
  const time = s.length > 10 ? s.slice(11) : "00:00";
  const [y, mo, d] = [s.slice(0, 4), s.slice(5, 7), s.slice(8, 10)];
  return pattern
    .replace(/YYYY/g, y)
    .replace(/YY/g, y.slice(2))
    .replace(/MM/g, mo)
    .replace(/DD/g, d)
    .replace(/HH/g, time.slice(0, 2))
    .replace(/mm/g, time.slice(3, 5));
}

type Fn = { name: string; min: number; max: number; run: (args: FormulaValue[]) => FormulaValue };
const FUNCTIONS: Fn[] = [
  { name: "if", min: 3, max: 3, run: ([c, a, b]) => (c ? a : b) },
  { name: "and", min: 1, max: 99, run: (a) => a.every(Boolean) },
  { name: "or", min: 1, max: 99, run: (a) => a.some(Boolean) },
  { name: "not", min: 1, max: 1, run: ([a]) => !a },
  { name: "empty", min: 1, max: 1, run: ([a]) => a === "" || a === false },
  { name: "round", min: 1, max: 2, run: ([x, n = 0]) => {
      const factor = 10 ** num(n, "round");
      return Math.round(num(x, "round") * factor) / factor;
    } },
  { name: "floor", min: 1, max: 1, run: ([x]) => Math.floor(num(x, "floor")) },
  { name: "ceil", min: 1, max: 1, run: ([x]) => Math.ceil(num(x, "ceil")) },
  { name: "abs", min: 1, max: 1, run: ([x]) => Math.abs(num(x, "abs")) },
  { name: "sqrt", min: 1, max: 1, run: ([x]) => Math.sqrt(num(x, "sqrt")) },
  { name: "pow", min: 2, max: 2, run: ([x, y]) => num(x, "pow") ** num(y, "pow") },
  { name: "mod", min: 2, max: 2, run: ([x, y]) => (num(y, "mod") === 0 ? fail("divZero") : num(x, "mod") % num(y, "mod")) },
  { name: "min", min: 1, max: 99, run: (a) => Math.min(...a.map((v) => num(v, "min"))) },
  { name: "max", min: 1, max: 99, run: (a) => Math.max(...a.map((v) => num(v, "max"))) },
  { name: "sum", min: 1, max: 99, run: (a) => a.reduce<number>((s, v) => s + num(v, "sum"), 0) },
  { name: "number", min: 1, max: 1, run: ([x]) => {
      const n = typeof x === "number" ? x : Number(text(x).trim().replace(",", "."));
      return Number.isNaN(n) || text(x).trim() === "" ? fail("type", "number") : n;
    } },
  { name: "text", min: 1, max: 1, run: ([x]) => text(x) },
  { name: "concat", min: 1, max: 99, run: (a) => a.map(text).join("") },
  { name: "length", min: 1, max: 1, run: ([t]) => text(t).length },
  { name: "upper", min: 1, max: 1, run: ([t]) => text(t).toUpperCase() },
  { name: "lower", min: 1, max: 1, run: ([t]) => text(t).toLowerCase() },
  { name: "trim", min: 1, max: 1, run: ([t]) => text(t).trim() },
  { name: "contains", min: 2, max: 2, run: ([t, s]) => text(t).toLowerCase().includes(text(s).toLowerCase()) },
  { name: "replace", min: 3, max: 3, run: ([t, s, r]) => (text(s) === "" ? text(t) : text(t).split(text(s)).join(text(r))) },
  { name: "slice", min: 2, max: 3, run: ([t, from, to]) => text(t).slice(num(from, "slice"), to === undefined ? undefined : num(to, "slice")) },
  { name: "today", min: 0, max: 0, run: () => isoDay(new Date()) },
  { name: "now", min: 0, max: 0, run: () => isoMinute(new Date()) },
  { name: "days", min: 2, max: 2, run: ([from, to]) => dayDiff(day(from, "days"), day(to, "days")) },
  { name: "dateAdd", min: 2, max: 3, run: ([d, n, unit = "days"]) => addToDate(text(d), num(n, "dateAdd"), text(unit)) },
  { name: "formatDate", min: 1, max: 2, run: ([d, p = "DD/MM/YYYY"]) => formatWith(text(d), text(p)) },
  { name: "year", min: 1, max: 1, run: ([d]) => Number(day(d, "year").slice(0, 4)) },
  { name: "month", min: 1, max: 1, run: ([d]) => Number(day(d, "month").slice(5, 7)) },
  { name: "day", min: 1, max: 1, run: ([d]) => Number(day(d, "day").slice(8, 10)) },
  // 1 pour lundi, 7 pour dimanche.
  { name: "weekday", min: 1, max: 1, run: ([d]) => ((new Date(`${day(d, "weekday")}T12:00:00`).getDay() + 6) % 7) + 1 },
];

/** Noms des fonctions disponibles, dans l'ordre de l'aide. */
export const FORMULA_FUNCTION_NAMES = FUNCTIONS.map((f) => f.name);
const BY_NAME = new Map(FUNCTIONS.map((f) => [f.name.toLowerCase(), f]));

/** Découpe une formule ; dans les arguments d'une fonction, la virgule sépare au lieu de servir de décimale. */
function formulaTokens(expression: string): string[] {
  const tokens: string[] = [];
  const parens: boolean[] = []; // vrai pour une parenthèse ouverte par un appel de fonction
  const pattern = /\{[^}]*\}|"[^"]*"|'[^']*'|\d+(?:\.\d+)?|[A-Za-z_]+|==|!=|>=|<=|&&|\|\||\S/g;
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

type Run = { value: number | string | null; issue: FormulaIssue | null };

/** Valeur de remplacement d'une propriété vide lors du diagnostic : du bon type, pour ne signaler que de vraies erreurs. */
function sample(prop: Prop): FormulaValue {
  if (prop.type === "checkbox") return false;
  if (prop.type === "date" || prop.type === "created_time" || prop.type === "last_edited_time") return "2026-01-01";
  if (prop.type === "number" || prop.type === "formula" || prop.type === "rollup") return 1;
  return "x";
}

function run(expression: string, values: Record<string, Value>, props: Prop[], diagnose: boolean): Run {
  const tokens = formulaTokens(expression);
  let i = 0;
  // Dans empty(), une propriété vide vaut « » au lieu d'invalider la formule.
  let lenient = 0;
  let missing = false;

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
  const and = (): FormulaValue => {
    let v = comparison();
    while (tokens[i] === "&&") {
      i++;
      const r = comparison();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  };
  const or = (): FormulaValue => {
    let v = and();
    while (tokens[i] === "||") {
      i++;
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  };
  const atom = (): FormulaValue => {
    const tok = tokens[i++];
    if (tok === undefined) return fail("syntax", "");
    if (tok === "(") {
      const v = or();
      if (tokens[i++] !== ")") fail("unclosed");
      return v;
    }
    if (tok === "-") return -num(atom(), "-");
    if (tok === "!") return !atom();
    if (tok.startsWith('"') || tok.startsWith("'")) return tok.slice(1, -1);
    if (tok.startsWith("{")) {
      const name = tok.slice(1, -1).trim();
      const prop = props.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (!prop) return fail("unknownProp", name);
      const value = values[prop.id];
      if (prop.type === "checkbox") return value === true;
      if (typeof value === "number" || (typeof value === "string" && value !== "")) {
        // Une plage de dates donne son début.
        return prop.type === "date" ? (parseDateValue(value)?.start ?? value) : value;
      }
      if (lenient > 0) return "";
      if (diagnose) return sample(prop);
      missing = true;
      return fail("type", name);
    }
    if (/^[A-Za-z_]+$/.test(tok)) {
      const lower = tok.toLowerCase();
      if (lower === "true" || lower === "false") return lower === "true";
      const fn = BY_NAME.get(lower);
      if (!fn) return fail("unknownFunction", tok);
      if (tokens[i++] !== "(") return fail("syntax", tok);
      const args: FormulaValue[] = [];
      if (fn.name === "empty") lenient++;
      while (tokens[i] !== ")") {
        if (tokens[i] === undefined) return fail("unclosed");
        args.push(or());
        if (tokens[i] === ",") i++;
        else if (tokens[i] !== ")") return fail(tokens[i] === undefined ? "unclosed" : "syntax", tokens[i] ?? "");
      }
      i++;
      if (fn.name === "empty") lenient--;
      if (args.length < fn.min || args.length > fn.max)
        return fail("argCount", `${fn.name} ${fn.min === fn.max ? fn.min : `${fn.min}-${fn.max === 99 ? "…" : fn.max}`}`);
      return fn.run(args);
    }
    const n = Number(tok);
    return Number.isNaN(n) ? fail("syntax", tok) : n;
  };
  const product = (): FormulaValue => {
    let v = atom();
    while (tokens[i] === "*" || tokens[i] === "/" || tokens[i] === "%") {
      const op = tokens[i++];
      const r = num(atom(), op);
      const l = num(v, op);
      if ((op === "/" || op === "%") && r === 0) fail("divZero");
      v = op === "*" ? l * r : op === "/" ? l / r : l % r;
    }
    return v;
  };
  function sum(): FormulaValue {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const plus = tokens[i++] === "+";
      const right = product();
      // « + » colle deux textes ; avec deux nombres, il additionne.
      v =
        plus && (typeof v === "string" || typeof right === "string")
          ? text(v) + text(right)
          : plus
            ? num(v, "+") + num(right, "+")
            : num(v, "-") - num(right, "-");
    }
    return v;
  }

  try {
    if (tokens.length === 0) return { value: null, issue: null };
    const result = or();
    if (i !== tokens.length) return fail("syntax", tokens[i]);
    if (typeof result === "string") return { value: result, issue: null };
    const n = Number(result);
    return { value: Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null, issue: null };
  } catch (e) {
    // Une valeur manquante n'est pas une erreur de la formule : le résultat reste vide.
    if (e instanceof FormulaError && !missing) return { value: null, issue: e.issue };
    return { value: null, issue: null };
  }
}

/**
 * Évalue une formule : nombres, textes entre guillemets, propriétés entre accolades,
 * + - * / %, comparaisons, && || ! et les fonctions de FORMULA_FUNCTION_NAMES.
 * Renvoie null si elle est invalide ou qu'une valeur manque.
 */
export function evalFormula(expression: string, values: Record<string, Value>, props: Prop[]): number | string | null {
  return run(expression, values, props, false).value;
}

/** Erreur d'une formule (syntaxe, fonction ou propriété inconnue, types…), ou null si elle est correcte ; les valeurs vides ne comptent pas. */
export function formulaIssue(expression: string, props: Prop[]): FormulaIssue | null {
  return run(expression, {}, props, true).issue;
}
