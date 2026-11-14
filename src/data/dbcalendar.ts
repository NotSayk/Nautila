/** Calendrier et chronologie des bases : placement des événements (fonctions pures). */
import { addDays, dayDiff, isoDay, weekStart } from "./dbdate";

/** Événement couvrant des jours entiers, de `start` à `end` inclus. */
export type DayEvent = { id: string; start: string; end: string };

/** Morceau d'événement dans une semaine : colonne de départ (0-6), nombre de colonnes et ligne. */
export type Segment = { id: string; col: number; span: number; lane: number; clippedStart: boolean; clippedEnd: boolean };

/** Les 42 jours (six semaines) affichés pour le mois qui contient `month` (« AAAA-MM-JJ »). */
export function monthGrid(month: string, first: 0 | 1 = 1): string[] {
  const start = weekStart(`${month.slice(0, 7)}-01`, first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * Place les événements d'une semaine sur des lignes : un événement de plusieurs jours reste sur sa ligne,
 * les plus longs d'abord. Au-delà de `maxLanes`, les événements sont comptés par jour dans `hidden`.
 */
export function layoutWeek(
  events: DayEvent[],
  days: string[],
  maxLanes: number,
): { segments: Segment[]; hidden: number[]; total: number[] } {
  const [first, last] = [days[0], days[days.length - 1]];
  const inWeek = events
    .filter((e) => e.end >= first && e.start <= last)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id));
  const lanes: boolean[][] = []; // lanes[ligne][colonne] : colonne occupée
  const segments: Segment[] = [];
  const hidden = days.map(() => 0);
  const total = days.map(() => 0);
  for (const e of inWeek) {
    const col = Math.max(0, dayDiff(first, e.start));
    const end = Math.min(days.length - 1, dayDiff(first, e.end));
    for (let c = col; c <= end; c++) total[c]++;
    let lane = 0;
    while (lanes[lane]?.slice(col, end + 1).some(Boolean)) lane++;
    if (lane >= maxLanes) {
      for (let c = col; c <= end; c++) hidden[c]++;
      continue;
    }
    lanes[lane] ??= days.map(() => false);
    for (let c = col; c <= end; c++) lanes[lane][c] = true;
    segments.push({
      id: e.id,
      col,
      span: end - col + 1,
      lane,
      clippedStart: e.start < first,
      clippedEnd: e.end > last,
    });
  }
  return { segments, hidden, total };
}

/** Événements qui couvrent un jour. */
export const eventsOn = (events: DayEvent[], day: string) => events.filter((e) => e.start <= day && day <= e.end);

export type Zoom = "day" | "week" | "month";
/** Largeur d'un jour en pixels, selon l'échelle de la chronologie. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 30, week: 12, month: 4 };

/** Jours de début et de fin d'une barre après un déplacement ou un redimensionnement de `days` jours. */
export function shiftSpan(
  start: string,
  end: string,
  mode: "move" | "start" | "end",
  days: number,
): { start: string; end: string } {
  if (mode === "move") return { start: addDays(start, days), end: addDays(end, days) };
  if (mode === "start") {
    const next = addDays(start, days);
    return { start: next > end ? end : next, end };
  }
  const next = addDays(end, days);
  return { start, end: next < start ? start : next };
}

export type Tick = { offset: number; days: number; label: string };

/** Graduations de la chronologie : deux rangées (grande période, puis jour, semaine ou mois), en jours depuis `from`. */
export function timelineTicks(
  from: string,
  count: number,
  zoom: Zoom,
  lang: string,
  first: 0 | 1 = 1,
): { top: Tick[]; bottom: Tick[] } {
  const last = addDays(from, count - 1);
  const top: Tick[] = [];
  const bottom: Tick[] = [];
  const monthName = (day: string, style: "long" | "short") => {
    const text = new Intl.DateTimeFormat(lang, { month: style, year: style === "long" ? "numeric" : undefined }).format(
      new Date(`${day.slice(0, 7)}-15T12:00:00`),
    );
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  // Rangée de périodes consécutives qui portent le même libellé (mois ou année).
  const runs = (label: (day: string) => string, into: Tick[]) => {
    for (let i = 0; i < count; i++) {
      const text = label(addDays(from, i));
      const prev = into[into.length - 1];
      if (prev && prev.label === text) prev.days++;
      else into.push({ offset: i, days: 1, label: text });
    }
  };
  if (zoom === "month") {
    runs((d) => d.slice(0, 4), top);
    runs((d) => monthName(d, "short"), bottom);
    return { top, bottom };
  }
  runs((d) => monthName(d, "long"), top);
  if (zoom === "day") {
    for (let i = 0; i < count; i++) bottom.push({ offset: i, days: 1, label: String(Number(addDays(from, i).slice(8))) });
  } else {
    // Une graduation par semaine, la première rognée si elle commence avant `from`.
    const startOfWeek = weekStart(from, first);
    for (let day = startOfWeek; day <= last; day = addDays(day, 7)) {
      const offset = dayDiff(from, day);
      if (offset + 7 <= 0) continue;
      const clip = Math.max(0, -offset);
      bottom.push({
        offset: Math.max(0, offset),
        days: Math.min(7 - clip, count - Math.max(0, offset)),
        label: String(Number(day.slice(8))),
      });
    }
  }
  return { top, bottom };
}

/** Aujourd'hui en « AAAA-MM-JJ ». */
export const todayIso = () => isoDay(new Date());
