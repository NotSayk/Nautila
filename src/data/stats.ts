import { db } from "../db";

/** Statistiques d'étude. Les jours sont ceux du fuseau de l'appareil, au format « AAAA-MM-JJ ». */

const DAY = 86_400_000;

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midi du jour `key` (midi : insensible aux changements d'heure). */
export const keyNoon = (key: string) => new Date(`${key}T12:00:00`).getTime();

export function addDays(key: string, n: number): string {
  const d = new Date(keyNoon(key));
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

/** Lundi de la semaine du jour `key`. */
export const weekStart = (key: string) => addDays(key, -((new Date(keyNoon(key)).getDay() + 6) % 7));

/**
 * Série de jours consécutifs avec au moins une révision. La série en cours se termine aujourd'hui, ou
 * hier si rien n'a encore été révisé aujourd'hui (elle n'est pas perdue avant la fin de la journée).
 */
export function streaks(days: Iterable<string>, today: string): { current: number; best: number; today: boolean } {
  const set = new Set(days);
  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // pas le début d'une série
    let n = 1;
    while (set.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }
  let current = 0;
  for (let d = set.has(today) ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current++;
  return { current, best, today: set.has(today) };
}

export type HeatCell = { key: string; count: number; future: boolean };

/** Carte de chaleur : `weeks` colonnes de lundi à dimanche, la dernière contenant aujourd'hui. */
export function heatmap(counts: Map<string, number>, today: string, weeks = 26): HeatCell[][] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const key = addDays(first, w * 7 + d);
      return { key, count: counts.get(key) ?? 0, future: key > today };
    }),
  );
}

/** Intensité de 0 (rien) à 4, en quarts du maximum. */
export const heatLevel = (count: number, max: number) => (count <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));

/** Part des réponses qui ne sont pas « à revoir » ; null sans réponse. */
export function successRate(grades: number[]): number | null {
  if (!grades.length) return null;
  return grades.filter((g) => g > 1).length / grades.length;
}

/** Répartition des cartes selon leur état FSRS : nouvelles, en apprentissage (ou réapprentissage), acquises. */
export function cardBuckets(states: number[]): { fresh: number; learning: number; mature: number } {
  const out = { fresh: 0, learning: 0, mature: 0 };
  for (const s of states) {
    if (s === 0) out.fresh++;
    else if (s === 2) out.mature++;
    else out.learning++;
  }
  return out;
}

/** Cartes dues chaque jour sur `days` jours ; le retard compte pour aujourd'hui. Les cartes nouvelles sont à part. */
export function forecast(dues: number[], now: number, days = 14): { key: string; count: number }[] {
  const today = dayKey(now);
  const out = Array.from({ length: days }, (_, i) => ({ key: addDays(today, i), count: 0 }));
  const index = new Map(out.map((d, i) => [d.key, i]));
  for (const due of dues) {
    const key = dayKey(due);
    const i = key <= today ? 0 : index.get(key);
    if (i !== undefined) out[i].count++;
  }
  return out;
}

/** Temps d'étude par matière sur les `days` derniers jours (aujourd'hui compris), du plus long au plus court. */
export function timeByCourse(
  rows: { course_id: string | null; started_at: number; duration: number }[],
  now: number,
  days: number,
): { course_id: string | null; duration: number }[] {
  const from = keyNoon(addDays(dayKey(now), -(days - 1))) - DAY / 2;
  const sums = new Map<string | null, number>();
  for (const r of rows) if (r.started_at >= from) sums.set(r.course_id, (sums.get(r.course_id) ?? 0) + r.duration);
  return [...sums].map(([course_id, duration]) => ({ course_id, duration })).sort((a, b) => b.duration - a.duration);
}

/** Durée lisible : « 25 min », « 1 h 05 ». */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

// ---------- Lecture en base ----------

const stateOf = (fsrs: string) => {
  try {
    return Number(JSON.parse(fsrs).state) || 0;
  } catch {
    return 0;
  }
};

/** Série et révisions du jour, pour l'accueil. */
export async function reviewSummary(now = Date.now()) {
  const rows = await db().all<{ at: number }>("SELECT at FROM review_log");
  const today = dayKey(now);
  const keys = rows.map((r) => dayKey(r.at));
  return { ...streaks(keys, today), reviewedToday: keys.filter((k) => k === today).length };
}

export type StudyStats = {
  streak: { current: number; best: number; today: boolean };
  today: number;
  week: number;
  heat: HeatCell[][];
  success: number | null;
  decks: { page_id: string; reviews: number; success: number | null }[];
  buckets: { fresh: number; learning: number; mature: number };
  forecast: { key: string; count: number }[];
  time7: { course_id: string | null; duration: number }[];
  time30: { course_id: string | null; duration: number }[];
};

export async function loadStudyStats(now = Date.now()): Promise<StudyStats> {
  const live = "page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL)";
  const [logs, cards, sessions] = await Promise.all([
    db().all<{ at: number; grade: number; page_id: string }>("SELECT at, grade, page_id FROM review_log"),
    db().all<{ fsrs: string; due: number }>(`SELECT fsrs, due FROM cards WHERE ${live}`),
    db().all<{ course_id: string | null; started_at: number; duration: number }>(
      "SELECT course_id, started_at, duration FROM study_log WHERE started_at >= ?",
      [now - 31 * DAY],
    ),
  ]);
  const today = dayKey(now);
  const monday = weekStart(today);
  const counts = new Map<string, number>();
  const byDeck = new Map<string, number[]>();
  let week = 0;
  for (const l of logs) {
    const key = dayKey(l.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (key >= monday && key <= today) week++;
    const grades = byDeck.get(l.page_id);
    if (grades) grades.push(l.grade);
    else byDeck.set(l.page_id, [l.grade]);
  }
  const states = cards.map((c) => stateOf(c.fsrs));
  return {
    streak: streaks(counts.keys(), today),
    today: counts.get(today) ?? 0,
    week,
    heat: heatmap(counts, today),
    success: successRate(logs.map((l) => l.grade)),
    decks: [...byDeck]
      .map(([page_id, grades]) => ({ page_id, reviews: grades.length, success: successRate(grades) }))
      .sort((a, b) => b.reviews - a.reviews),
    buckets: cardBuckets(states),
    // Les cartes jamais vues ne sont pas « dues » : elles apparaissent dans la répartition.
    forecast: forecast(
      cards.filter((_, i) => states[i] !== 0).map((c) => c.due),
      now,
    ),
    time7: timeByCourse(sessions, now, 7),
    time30: timeByCourse(sessions, now, 30),
  };
}

/**
 * Journalise une séance de travail du Pomodoro. L'identifiant dérive de l'heure de fin : deux fenêtres
 * ouvertes sur la même séance n'écrivent qu'une ligne.
 */
export const logStudySession = (endsAt: number, courseId: string | null, duration: number) =>
  db().run("INSERT OR IGNORE INTO study_log (id, course_id, started_at, duration, kind) VALUES (?,?,?,?,'pomodoro')", [
    `pomodoro-${endsAt}`,
    courseId,
    endsAt - duration,
    duration,
  ]);

// ---------- Objectif du jour (réglage de l'appareil) ----------

const GOAL_KEY = "nautila.dailyGoal";
export const DEFAULT_GOAL = 20;

export function dailyGoal(): number {
  try {
    const n = Number(localStorage.getItem(GOAL_KEY));
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_GOAL;
  } catch {
    return DEFAULT_GOAL;
  }
}

export function setDailyGoal(n: number) {
  try {
    localStorage.setItem(GOAL_KEY, String(Math.max(1, Math.min(999, Math.round(n)))));
  } catch {
    /* réglage non mémorisé, sans gravité */
  }
}
