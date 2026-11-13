import type { Slot } from "./school";

/**
 * Lecture d'un calendrier iCalendar (.ics, RFC 5545) pour l'emploi du temps.
 *
 * L'emploi du temps de Nautila est une semaine type : chaque événement daté est
 * ramené à un créneau (jour de la semaine, heure de début et de fin, salle).
 * Les séances identiques d'une semaine à l'autre ne donnent qu'un créneau, dont
 * on compte les occurrences pour distinguer les cours réguliers des séances isolées.
 */

export type IcalSlot = Omit<Slot, "id" | "course_id"> & {
  /** Nombre de séances trouvées pour ce créneau (Infinity pour une répétition sans fin). */
  count: number;
};

type Prop = { name: string; params: Record<string, string>; value: string };

/** Déplie les lignes continuées (une ligne qui commence par une espace prolonge la précédente). */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  // Le nom et les paramètres s'arrêtent au premier « : » hors guillemets.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescapeText = (s: string) =>
  s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? " " : c)).replace(/\s+/g, " ").trim();

type Moment = { date: Date; day: number; minutes: number };

/**
 * Date et heure d'un DTSTART/DTEND. Une heure en UTC (suffixe Z) est convertie
 * dans le fuseau de l'appareil ; une heure avec TZID ou sans fuseau est prise
 * telle quelle (c'est l'heure affichée dans le calendrier d'origine).
 * Renvoie null pour une journée entière (sans heure).
 */
function parseMoment(prop: Prop): Moment | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, utc] = m;
  const date = utc
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)))
    : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  return { date, day: (date.getDay() + 6) % 7, minutes: date.getHours() * 60 + date.getMinutes() };
}

/** Durée ISO 8601 (« PT1H30M », « P1D ») en minutes. */
function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi] = m;
  const total = (+(w ?? 0) * 7 + +(d ?? 0)) * 1440 + +(h ?? 0) * 60 + +(mi ?? 0);
  return sign === "-" ? -total : total;
}

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * Jours et nombre de séances d'une règle de répétition hebdomadaire.
 * Les autres fréquences (quotidienne, mensuelle…) ne correspondent pas à une
 * semaine type : l'événement est alors compté comme une séance unique.
 */
function weekly(rrule: string, start: Moment): { days: number[]; count: number } {
  const rule = Object.fromEntries(
    rrule.split(";").map((part) => {
      const [k, v = ""] = part.split("=");
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  if (rule.FREQ !== "WEEKLY") return { days: [start.day], count: 1 };
  const days = (rule.BYDAY ? rule.BYDAY.split(",") : [])
    .map((d: string) => DAYS.indexOf(d.slice(-2)))
    .filter((d: number) => d >= 0);
  const list = days.length ? [...new Set<number>(days)] : [start.day];
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  if (rule.COUNT) return { days: list, count: Math.max(1, Math.round(Number(rule.COUNT) / list.length)) };
  if (rule.UNTIL) {
    const until = parseMoment({ name: "UNTIL", params: {}, value: rule.UNTIL.length === 8 ? `${rule.UNTIL}T235959` : rule.UNTIL });
    if (until) {
      const weeks = Math.floor((until.date.getTime() - start.date.getTime()) / (7 * 864e5));
      return { days: list, count: Math.max(1, Math.floor(weeks / interval) + 1) };
    }
  }
  return { days: list, count: Infinity };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** « HH:MM » ; minuit en fin de journée devient 23:59, que les champs d'heure acceptent. */
const hhmm = (minutes: number) => (minutes >= 1440 ? "23:59" : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);

/** Créneaux hebdomadaires d'un fichier .ics, du plus fréquent au plus rare. */
export function parseIcal(text: string): IcalSlot[] {
  const slots = new Map<string, IcalSlot>();
  let event: Prop[] | null = null;

  const add = (props: Prop[]) => {
    const get = (name: string) => props.find((p) => p.name === name);
    if (get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") return;
    const dtstart = get("DTSTART");
    const start = dtstart && parseMoment(dtstart);
    if (!start) return;
    const dtend = get("DTEND");
    const end = dtend && parseMoment(dtend);
    const duration = end
      ? Math.round((end.date.getTime() - start.date.getTime()) / 60000)
      : parseDuration(get("DURATION")?.value ?? "");
    // Un créneau tient dans une journée : on écarte les événements sans durée ou qui passent minuit.
    if (!duration || duration <= 0 || start.minutes + duration > 24 * 60) return;
    const title = unescapeText(get("SUMMARY")?.value ?? "");
    const room = unescapeText(get("LOCATION")?.value ?? "");
    if (!title) return;
    const rrule = get("RRULE");
    const { days, count } = rrule ? weekly(rrule.value, start) : { days: [start.day], count: 1 };
    for (const day of days) {
      const slot = { title, day, start: hhmm(start.minutes), end: hhmm(start.minutes + duration), room };
      const key = JSON.stringify([slot.title, slot.day, slot.start, slot.end, slot.room]);
      const known = slots.get(key);
      if (known) known.count += count;
      else slots.set(key, { ...slot, count });
    }
  };

  // Profondeur dans l'événement : les composants imbriqués (rappels VALARM) sont ignorés.
  let depth = 0;
  for (const line of unfold(text)) {
    const prop = parseLine(line);
    if (!prop) continue;
    const value = prop.value.trim().toUpperCase();
    if (prop.name === "BEGIN") {
      if (event) depth++;
      else if (value === "VEVENT") event = [];
    } else if (prop.name === "END") {
      if (event && depth > 0) depth--;
      else if (event && value === "VEVENT") {
        add(event);
        event = null;
      }
    } else if (event && depth === 0) event.push(prop);
  }

  return [...slots.values()].sort((a, b) => b.count - a.count || a.day - b.day || a.start.localeCompare(b.start));
}

/** Texte en minuscules, sans accents ni ponctuation, entouré d'espaces pour comparer des mots entiers. */
const words = (s: string) =>
  ` ${s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** Matière dont le nom apparaît en mots entiers dans l'intitulé du cours (la plus longue l'emporte). */
export function matchCourse(title: string, courses: { id: string; title: string }[]): string | null {
  const text = words(title);
  let best: { id: string; length: number } | null = null;
  for (const c of courses) {
    const name = words(c.title);
    if (name.trim().length < 2 || !text.includes(name)) continue;
    if (!best || name.length > best.length) best = { id: c.id, length: name.length };
  }
  return best?.id ?? null;
}
