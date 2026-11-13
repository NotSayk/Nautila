/**
 * Lecture d'un calendrier iCalendar (.ics, RFC 5545) : ADE, HyperPlanning, Celcat, agendas.
 *
 * Chaque séance garde sa date. Les répétitions (RRULE quotidiennes et hebdomadaires,
 * avec EXDATE et les séances déplacées par RECURRENCE-ID) sont développées en séances.
 */

export type IcalEvent = {
  /** Identifiant stable d'une séance d'un fichier à l'autre (UID, plus la date pour une répétition). */
  key: string;
  title: string;
  /** Intitulé brut (SUMMARY), tel que l'ancien import l'utilisait pour les créneaux de la semaine type. */
  summary: string;
  start: number;
  end: number;
  allDay: boolean;
  room: string;
  teacher: string;
  /** Type de séance (CM, TD, TP…), quand le fichier l'indique. */
  kind: string;
  note: string;
  cancelled: boolean;
};

export type IcalCalendar = { name: string; events: IcalEvent[] };

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

/** Texte iCalendar : les « \n » deviennent des retours à la ligne, les autres caractères échappés sont rendus. */
const unescape = (s: string) => s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
const oneLine = (s: string) => unescape(s).replace(/\s+/g, " ").trim();

const DAY = 864e5;

/** Décalage (ms) entre l'heure affichée dans un fuseau et l'heure UTC, à un instant donné. */
function zoneOffset(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}

/**
 * Instant d'une date iCalendar. Une heure en UTC (suffixe Z) est exacte ; une heure
 * avec TZID est convertie depuis ce fuseau (s'il est connu) ; sinon c'est l'heure locale.
 */
function parseDate(value: string, tzid?: string): { at: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, utc] = m;
  if (h === undefined) return { at: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  if (utc) return { at: wall, allDay: false };
  if (tzid)
    try {
      const first = wall - zoneOffset(tzid, wall);
      return { at: wall - zoneOffset(tzid, first), allDay: false };
    } catch {
      // Fuseau inconnu (noms Windows, par exemple) : on garde l'heure locale.
    }
  return { at: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)).getTime(), allDay: false };
}

const dateOf = (prop: Prop | undefined) => (prop ? parseDate(prop.value, prop.params.TZID) : null);

/** Durée ISO 8601 (« PT1H30M », « P1D ») en millisecondes. */
function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const total = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -total : total;
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** Au-delà, une répétition sans fin n'est plus développée. */
const HORIZON = 2 * 365 * DAY;
const MAX_OCCURRENCES = 1000;

/** Même heure locale, `days` jours plus tard (les changements d'heure sont respectés). */
function shiftDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Débuts des séances d'une règle de répétition (quotidienne ou hebdomadaire). */
function expand(rrule: string, start: number, allDay: boolean): number[] {
  const rule = Object.fromEntries(
    rrule.split(";").map((part) => {
      const [k, v = ""] = part.split("=");
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? (parseDate(rule.UNTIL)?.at ?? Infinity) : Infinity;
  const limit = Math.min(until + (rule.UNTIL?.length === 8 || allDay ? DAY - 1 : 0), start + HORIZON);
  const out: number[] = [];
  const push = (at: number) => {
    if (at < start || at > limit || out.length >= Math.min(count, MAX_OCCURRENCES)) return false;
    out.push(at);
    return true;
  };

  if (rule.FREQ === "DAILY") {
    for (let i = 0; push(shiftDays(start, i * interval)); i++);
  } else if (rule.FREQ === "WEEKLY") {
    const startDay = (new Date(start).getDay() + 6) % 7;
    const days = (rule.BYDAY ? rule.BYDAY.split(",") : [])
      .map((d: string) => WEEKDAYS.indexOf(d.slice(-2)))
      .filter((d: number) => d >= 0)
      .sort((a: number, b: number) => a - b);
    const list = days.length ? [...new Set<number>(days)] : [startDay];
    const monday = shiftDays(start, -startDay);
    outer: for (let week = 0; ; week += interval) {
      for (const day of list) {
        const at = shiftDays(monday, week * 7 + day);
        if (at < start) continue;
        if (!push(at)) break outer;
      }
    }
  } else return [start];
  return out.length ? out : [start];
}

/** Champs « Clé : valeur » de la description (HyperPlanning les écrit ainsi). */
function fields(description: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of unescape(description).split("\n")) {
    const m = /^\s*([^:]{1,30}?)\s*:\s*(.*)$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

type Raw = { props: Prop[] };

/** Lit un fichier .ics : nom du calendrier et séances, triées par date. */
export function parseIcal(text: string): IcalCalendar {
  const raws: Raw[] = [];
  let name = "";
  let event: Prop[] | null = null;
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
        raws.push({ props: event });
        event = null;
      }
    } else if (event && depth === 0) event.push(prop);
    else if (!event && prop.name === "X-WR-CALNAME") name = oneLine(prop.value);
  }

  // Les séances déplacées d'une répétition (RECURRENCE-ID) remplacent la séance d'origine.
  const moved = new Map<string, Set<number>>();
  for (const { props } of raws) {
    const rid = dateOf(props.find((p) => p.name === "RECURRENCE-ID"));
    const uid = props.find((p) => p.name === "UID")?.value.trim();
    if (rid && uid) moved.set(uid, (moved.get(uid) ?? new Set()).add(rid.at));
  }

  const events: IcalEvent[] = [];
  const used = new Set<string>();
  for (const { props } of raws) {
    const get = (n: string) => props.find((p) => p.name === n);
    const start = dateOf(get("DTSTART"));
    if (!start) continue;
    const endProp = dateOf(get("DTEND"));
    const duration = endProp
      ? endProp.at - start.at
      : (parseDuration(get("DURATION")?.value ?? "") ?? (start.allDay ? DAY : 0));
    if (duration < 0) continue;

    const summary = oneLine(get("SUMMARY")?.value ?? "");
    const info = fields(get("DESCRIPTION")?.value ?? "");
    const cancelled =
      get("STATUS")?.value.trim().toUpperCase() === "CANCELLED" || /^annulation\b/i.test(summary) || "annulation" in info;
    const title = info["matière"] || summary.replace(/^annulation\s*:\s*/i, "") || "";
    if (!title) continue;
    const uid = get("UID")?.value.trim() ?? "";
    const rid = dateOf(get("RECURRENCE-ID"));
    const rrule = get("RRULE");
    const excluded = new Set<number>(moved.get(uid) ?? []);
    for (const ex of props.filter((p) => p.name === "EXDATE"))
      for (const v of ex.value.split(",")) {
        const at = parseDate(v, ex.params.TZID)?.at;
        if (at !== undefined) excluded.add(at);
      }

    const starts = rrule && !rid ? expand(rrule.value, start.at, start.allDay) : [start.at];
    for (const at of starts) {
      if (rrule && !rid && excluded.has(at)) continue;
      const end = rrule ? at + duration : start.at + duration;
      let key = uid ? (rrule || rid ? `${uid}@${rid?.at ?? at}` : uid) : `${summary}@${at}`;
      for (let n = 2; used.has(key); n++) key = `${key}#${n}`;
      used.add(key);
      events.push({
        key,
        title,
        summary,
        start: at,
        end: Math.max(end, at),
        allDay: start.allDay,
        room: oneLine(get("LOCATION")?.value ?? ""),
        teacher: info["enseignants"] || info["enseignant"] || "",
        kind: info["type"] || "",
        note: info["mémo"] || info["memo"] || "",
        cancelled,
      });
    }
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  return { name, events };
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

const pad = (n: number) => String(n).padStart(2, "0");
/** « HH:MM » de l'heure locale d'un instant. */
export const clock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Clés (intitulé, jour, début, fin, salle) des créneaux de la semaine type que la
 * première version de l'import créait pour ces séances : ils font double emploi.
 */
export function legacySlotKeys(events: IcalEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const e of events) {
    if (e.allDay) continue;
    const minutes = (e.end - e.start) / 60000;
    const startMin = new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes();
    const end = startMin + minutes >= 1440 ? "23:59" : clock(e.end);
    keys.add(JSON.stringify([e.summary, (new Date(e.start).getDay() + 6) % 7, clock(e.start), end, e.room]));
  }
  return keys;
}
