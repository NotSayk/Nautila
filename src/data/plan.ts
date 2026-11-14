import { db } from "../db";
import type { CardRow } from "./cards";
import type { Task } from "./tasks";

/** Plan de révision d'un examen : cartes de la matière à voir d'ici là et charge quotidienne. */

const DAY = 86_400_000;
const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);

/** Au-delà, la charge quotidienne est signalée comme irréaliste. */
export const HEAVY_CARDS = 150;
export const HEAVY_MINUTES = 120;
/** Temps de réponse supposé tant que le journal des révisions n'en dit pas assez (en secondes). */
export const DEFAULT_SECONDS = 15;

/** La page et toutes ses sous-pages. */
export function subtreeIds(pages: { id: string; parent_id: string | null }[], root: string): string[] {
  const children = new Map<string, string[]>();
  for (const p of pages) if (p.parent_id) children.set(p.parent_id, [...(children.get(p.parent_id) ?? []), p.id]);
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) ?? []) walk(c);
  };
  walk(root);
  return out;
}

const stateOf = (fsrs: string) => {
  try {
    return Number(JSON.parse(fsrs).state) || 0;
  } catch {
    return 0;
  }
};

export type ExamPlan = {
  /** Jours de révision restants, aujourd'hui compris, jusqu'à la veille de l'examen (au moins 1). */
  days: number;
  /** Jours avant l'examen (négatif s'il est passé). */
  until: number;
  fresh: number;
  due: number;
  total: number;
  perDay: number;
  minutes: number;
  heavy: boolean;
};

/**
 * Calcule le plan : cartes jamais vues, cartes déjà vues qui seront dues avant l'examen, et leur
 * répartition sur les jours restants. Les répétitions d'apprentissage des nouvelles cartes s'y ajoutent.
 */
export function examPlan(
  cards: Pick<CardRow, "fsrs" | "due">[],
  examAt: number,
  now: number,
  secondsPerCard = DEFAULT_SECONDS,
): ExamPlan {
  const until = Math.round((startOfDay(examAt) - startOfDay(now)) / DAY);
  const days = Math.max(1, until);
  const examDay = startOfDay(examAt);
  let fresh = 0;
  let due = 0;
  for (const c of cards) {
    if (stateOf(c.fsrs) === 0) fresh++;
    else if (c.due < Math.max(examDay, now + 1)) due++;
  }
  const total = fresh + due;
  const perDay = Math.ceil(total / days);
  const minutes = Math.ceil((perDay * secondsPerCard) / 60);
  return { days, until, fresh, due, total, perDay, minutes, heavy: perDay > HEAVY_CARDS || minutes > HEAVY_MINUTES };
}

/** Séance d'examen : les cartes dues d'abord (les plus en retard en premier), puis les nouvelles dans l'ordre du paquet. */
export function orderSession<T extends Pick<CardRow, "fsrs" | "due">>(cards: T[], now: number): T[] {
  const seen = cards.filter((c) => stateOf(c.fsrs) !== 0 && c.due <= now).sort((a, b) => a.due - b.due);
  const fresh = cards.filter((c) => stateOf(c.fsrs) === 0);
  return [...seen, ...fresh];
}

// ---------- Lecture en base ----------

const COLUMNS = "id, page_id, front, back, fsrs, due";

async function cardsOf(pageIds: string[]) {
  if (!pageIds.length) return [];
  return db().all<CardRow & { created_at: number }>(
    `SELECT ${COLUMNS}, created_at FROM cards WHERE page_id IN (${pageIds.map(() => "?").join(",")})
     AND page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL) ORDER BY created_at, id`,
    pageIds,
  );
}

/** Temps moyen de réponse d'après le journal (au moins 20 réponses), sinon la valeur par défaut. */
async function secondsPerCard(): Promise<number> {
  const [row] = await db().all<{ n: number; avg: number | null }>(
    "SELECT COUNT(*) AS n, AVG(duration) AS avg FROM review_log WHERE duration IS NOT NULL AND duration < 120000",
  );
  return row && row.n >= 20 && row.avg ? Math.min(60, Math.max(5, row.avg / 1000)) : DEFAULT_SECONDS;
}

export type ExamDetail = {
  plan: ExamPlan;
  pageIds: string[];
  /** Cartes par page de la matière : total, nouvelles, dues d'ici l'examen. */
  byPage: { page_id: string; total: number; fresh: number; due: number }[];
};

export async function loadExamPlan(task: Task, pages: { id: string; parent_id: string | null }[], now = Date.now()) {
  if (!task.course_id || task.due_at === null) return null;
  const pageIds = subtreeIds(pages, task.course_id);
  const [cards, seconds] = await Promise.all([cardsOf(pageIds), secondsPerCard()]);
  const byPage = new Map<string, Pick<CardRow, "fsrs" | "due">[]>();
  for (const c of cards) byPage.set(c.page_id, [...(byPage.get(c.page_id) ?? []), c]);
  const detail: ExamDetail = {
    plan: examPlan(cards, task.due_at, now, seconds),
    pageIds,
    byPage: [...byPage].map(([page_id, list]) => {
      const p = examPlan(list, task.due_at!, now, seconds);
      return { page_id, total: list.length, fresh: p.fresh, due: p.due };
    }),
  };
  return detail;
}

/** Cartes de la séance « Réviser pour cet examen » (matière et sous-pages). */
export async function examSessionCards(pageIds: string[], now = Date.now()): Promise<CardRow[]> {
  return orderSession(await cardsOf(pageIds), now);
}

/** Examens à venir (aujourd'hui compris), du plus proche au plus lointain. */
export const upcomingExams = (tasks: Task[], now = Date.now()) =>
  tasks
    .filter((x) => x.kind === "exam" && !x.done && x.due_at !== null && startOfDay(x.due_at) >= startOfDay(now))
    .sort((a, b) => a.due_at! - b.due_at!);
