/**
 * Dates des bases de données (fonctions pures).
 * Une valeur de date est un texte : « AAAA-MM-JJ », « AAAA-MM-JJTHH:mm », ou une plage « début/fin ».
 * Les anciennes valeurs (jour seul) restent valides telles quelles.
 */

export type DateBucket = "day" | "week" | "month" | "year";
export type DateValue = { start: string; end: string | null; time: boolean };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** Vrai pour une date réelle (le 31 février est refusé), avec une heure facultative. */
export function validDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d, 12);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return false;
  return m[4] === undefined || (Number(m[4]) < 24 && Number(m[5]) < 60);
}

export const dayPart = (value: string) => value.slice(0, 10);
const timePart = (value: string) => (value.length > 10 ? value.slice(10) : "");

/** Lit une valeur de date ; null si elle est vide ou invalide. */
export function parseDateValue(value: unknown): DateValue | null {
  if (typeof value !== "string") return null;
  const [start, end] = value.split("/");
  if (!validDate(start)) return null;
  let last = end !== undefined && validDate(end) ? end : null;
  if (last !== null && dayPart(last) < dayPart(start)) last = null;
  return { start, end: last, time: start.length > 10 || (last?.length ?? 0) > 10 };
}

/** Écrit une valeur de date ; la fin n'est écrite que si elle diffère du début. */
export function serializeDate(start: string, end?: string | null): string {
  return end && end !== start ? `${start}/${end}` : start;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoMinute = (d: Date) => `${isoDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const noon = (day: string) => new Date(`${dayPart(day)}T12:00:00`);

/** Jour décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  const d = noon(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Nombre de jours de `a` à `b` (négatif si `b` précède `a`). */
export const dayDiff = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);

/** Premier jour de la semaine : lundi en français, dimanche en anglais. */
export const weekStartFor = (lang: string): 0 | 1 => (lang.startsWith("fr") ? 1 : 0);

/** Premier jour de la semaine qui contient `day` (`first` : 0 dimanche, 1 lundi). */
export function weekStart(day: string, first: 0 | 1 = 1): string {
  const d = noon(day);
  return addDays(day, -((d.getDay() - first + 7) % 7));
}

/** Début de la période (jour, semaine, mois, année) qui contient le jour. */
export function bucketOf(day: string, by: DateBucket, first: 0 | 1 = 1): string {
  const d = dayPart(day);
  if (by === "week") return weekStart(d, first);
  if (by === "month") return d.slice(0, 7);
  if (by === "year") return d.slice(0, 4);
  return d;
}

/** Libellé d'une période, d'après sa clé. */
export function bucketLabel(key: string, by: DateBucket, lang: string): string {
  if (by === "year") return key;
  if (by === "month") {
    const text = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(noon(`${key}-01`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const fmt = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" });
  if (by === "week") return `${fmt.format(noon(key))} – ${fmt.format(noon(addDays(key, 6)))}`;
  return fmt.format(noon(key));
}

export const RELATIVE_PRESETS = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "past_7",
  "next_7",
  "past_30",
  "next_30",
] as const;
export type RelativePreset = (typeof RELATIVE_PRESETS)[number];

/** Plage de jours [début, fin] d'une période relative, d'après aujourd'hui. */
export function relativeRange(preset: string, today: string, first: 0 | 1 = 1): [string, string] | null {
  const monthStart = (shift: number) => {
    const d = noon(today);
    return new Date(d.getFullYear(), d.getMonth() + shift, 1, 12);
  };
  const monthRange = (shift: number): [string, string] => [
    isoDay(monthStart(shift)),
    isoDay(new Date(monthStart(shift + 1).getTime() - 86_400_000)),
  ];
  const week = (shift: number): [string, string] => {
    const start = addDays(weekStart(today, first), shift * 7);
    return [start, addDays(start, 6)];
  };
  switch (preset) {
    case "today":
      return [today, today];
    case "yesterday":
      return [addDays(today, -1), addDays(today, -1)];
    case "tomorrow":
      return [addDays(today, 1), addDays(today, 1)];
    case "this_week":
      return week(0);
    case "last_week":
      return week(-1);
    case "next_week":
      return week(1);
    case "this_month":
      return monthRange(0);
    case "last_month":
      return monthRange(-1);
    case "next_month":
      return monthRange(1);
    case "past_7":
      return [addDays(today, -6), today];
    case "next_7":
      return [today, addDays(today, 6)];
    case "past_30":
      return [addDays(today, -29), today];
    case "next_30":
      return [today, addDays(today, 29)];
    default:
      return null;
  }
}

/** Jours couverts par une valeur de date (début et fin du jour, heure ignorée) ; null si elle est invalide. */
export function spanOfValue(value: unknown, endValue?: unknown): { start: string; end: string } | null {
  const range = parseDateValue(value);
  if (!range) return null;
  const start = dayPart(range.start);
  let end = dayPart(range.end ?? range.start);
  const extra = parseDateValue(endValue);
  if (extra && dayPart(extra.start) > end) end = dayPart(extra.start);
  return { start, end };
}

/**
 * Valeurs à écrire pour déplacer ou redimensionner une plage. L'heure d'origine est conservée.
 * Avec une propriété de fin séparée, elle reçoit la fin ; sinon la plage s'écrit « début/fin » dans la date.
 */
export function writeSpan(
  value: unknown,
  endValue: unknown,
  start: string,
  end: string,
  separateEnd: boolean,
): { date: string; end?: string | null } {
  const old = parseDateValue(value);
  const withTime = (day: string, original: string | undefined) => `${day}${original ? timePart(original) : ""}`;
  const from = withTime(start, old?.start);
  if (separateEnd) {
    const oldEnd = parseDateValue(endValue);
    return { date: from, end: end === start && !oldEnd ? null : withTime(end, oldEnd?.start) };
  }
  return { date: serializeDate(from, end === start ? null : withTime(end, old?.end ?? undefined)) };
}

/** Texte lisible d'une valeur de date (jour, heure et plage), selon la langue. */
export function formatDateValue(value: unknown, lang: string): string {
  const range = parseDateValue(value);
  if (!range) return typeof value === "string" ? value : "";
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" });
  const hour = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  const one = (v: string) => {
    const base = day.format(noon(v));
    return v.length > 10 ? `${base} ${hour.format(new Date(`${v}:00`))}` : base;
  };
  return range.end ? `${one(range.start)} → ${one(range.end)}` : one(range.start);
}
