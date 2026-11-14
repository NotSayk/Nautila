import { db } from "../db";
import { clock, matchCourse, type IcalEvent } from "./ical";

/** Séance datée d'un calendrier importé. */
export type CalEvent = {
  id: string;
  calendar: string;
  title: string;
  start: number;
  end: number;
  all_day: number;
  room: string;
  teacher: string;
  kind: string;
  note: string;
  cancelled: number;
  course_id: string | null;
};

export type CalendarInfo = { calendar: string; count: number; first: number; last: number };

/** Séances qui chevauchent l'intervalle [from, to[. */
export const listEvents = (from: number, to: number) =>
  db().all<CalEvent>("SELECT * FROM events WHERE start < ? AND end > ? ORDER BY start, end", [to, from]);

/** Première séance (non annulée) qui se termine après `at`. */
export const nextEvent = async (at: number, calendar?: string) =>
  (
    await db().all<CalEvent>(
      `SELECT * FROM events WHERE end > ? AND all_day = 0 AND cancelled = 0 ${calendar ? "AND calendar = ?" : ""}
       ORDER BY start LIMIT 1`,
      calendar ? [at, calendar] : [at],
    )
  )[0] ?? null;

export const listCalendars = () =>
  db().all<CalendarInfo>(
    `SELECT calendar, COUNT(*) AS count, MIN(start) AS first, MAX(end) AS last
     FROM events GROUP BY calendar ORDER BY calendar`,
  );

export const deleteCalendar = (calendar: string) => db().run("DELETE FROM events WHERE calendar = ?", [calendar]);

/** Rattache toutes les séances d'un même cours (même intitulé, même calendrier) à une matière. */
export const setEventsCourse = (calendar: string, title: string, courseId: string | null) =>
  db().run("UPDATE events SET course_id = ? WHERE calendar = ? AND title = ?", [courseId, calendar, title]);

const FIELDS = ["title", "start", "end", "all_day", "room", "teacher", "kind", "note", "cancelled"] as const;

/**
 * Importe (ou met à jour) un calendrier : les séances déjà connues sont modifiées
 * sur place, les nouvelles ajoutées et celles qui ont disparu du fichier retirées.
 * La matière choisie pour un cours est conservée et reprise par ses nouvelles séances.
 */
export async function importEvents(
  calendar: string,
  events: IcalEvent[],
  courses: { id: string; title: string }[],
  removeSlots: string[] = [],
): Promise<{ added: number; updated: number; removed: number }> {
  const existing = await db().all<CalEvent>("SELECT * FROM events WHERE calendar = ?", [calendar]);
  const known = new Map(existing.map((e) => [e.id, e]));
  const courseOf = new Map<string, string | null>();
  for (const e of existing) if (!courseOf.has(e.title) || e.course_id) courseOf.set(e.title, e.course_id);

  const statements: { sql: string; params: (string | number | null)[] }[] = [];
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const e of events) {
    const id = `${calendar}|${e.key}`;
    seen.add(id);
    const row = {
      title: e.title,
      start: e.start,
      end: e.end,
      all_day: e.allDay ? 1 : 0,
      room: e.room,
      teacher: e.teacher,
      kind: e.kind,
      note: e.note,
      cancelled: e.cancelled ? 1 : 0,
    };
    const old = known.get(id);
    if (!old) {
      const course = courseOf.has(e.title) ? courseOf.get(e.title)! : matchCourse(e.title, courses);
      statements.push({
        sql: `INSERT INTO events (id, calendar, course_id, ${FIELDS.join(", ")}) VALUES (?, ?, ?, ${FIELDS.map(() => "?").join(", ")})`,
        params: [id, calendar, course, ...FIELDS.map((f) => row[f])],
      });
      added++;
    } else if (FIELDS.some((f) => old[f] !== row[f])) {
      statements.push({
        sql: `UPDATE events SET ${FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`,
        params: [...FIELDS.map((f) => row[f]), id],
      });
      updated++;
    }
  }
  const gone = existing.filter((e) => !seen.has(e.id));
  for (const e of gone) statements.push({ sql: "DELETE FROM events WHERE id = ?", params: [e.id] });
  for (const id of removeSlots) statements.push({ sql: "DELETE FROM slots WHERE id = ?", params: [id] });
  if (statements.length) await db().batch(statements);
  return { added, updated, removed: gone.length };
}

export type DayClass = { id: string; start: string; end: string; title: string; room: string; cancelled: boolean };

/**
 * Cours d'une journée : créneaux de la semaine type (`day` : 0 = lundi) et séances
 * datées. Un créneau identique à une séance (même titre, mêmes heures) n'est listé qu'une fois.
 */
export function dayClasses(
  slots: { id: string; day: number; start: string; end: string; title: string; room: string }[],
  events: CalEvent[],
  dayStart: number,
  dayEnd: number,
  weekday: number,
): DayClass[] {
  const fromEvents = events
    .filter((e) => !e.all_day)
    .map((e) => ({
      id: e.id,
      start: e.start < dayStart ? "00:00" : clock(e.start),
      end: e.end > dayEnd ? "23:59" : clock(e.end),
      title: e.title,
      room: e.room,
      cancelled: !!e.cancelled,
    }));
  const same = (a: { title: string; start: string; end: string }, b: typeof a) =>
    a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.start === b.start && a.end === b.end;
  const fromSlots = slots
    .filter((s) => s.day === weekday)
    .map((s) => ({ id: s.id, start: s.start, end: s.end, title: s.title, room: s.room, cancelled: false }))
    .filter((s) => !fromEvents.some((e) => same(s, e)));
  return [...fromSlots, ...fromEvents].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Place côte à côte les séances qui se chevauchent dans une journée : chaque
 * séance reçoit une colonne et le nombre de colonnes de son groupe.
 */
export function layoutColumns<T extends { start: number; end: number }>(
  items: T[],
): (T & { col: number; cols: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: (T & { col: number; cols: number })[] = [];
  let group: (T & { col: number; cols: number })[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    const cols = Math.max(0, ...group.map((g) => g.col)) + 1;
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd && group.length) close();
    const busy = new Set(group.filter((g) => g.end > item.start).map((g) => g.col));
    let col = 0;
    while (busy.has(col)) col++;
    group.push({ ...item, col, cols: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return out;
}
