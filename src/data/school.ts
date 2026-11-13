import { db } from "../db";

export type Slot = {
  id: string;
  course_id: string | null;
  title: string;
  /** 0 = lundi … 6 = dimanche. */
  day: number;
  /** "HH:MM" */
  start: string;
  end: string;
  room: string;
};
export type Grade = {
  id: string;
  course_id: string;
  title: string;
  score: number;
  out_of: number;
  weight: number;
  created_at: number;
};

export const listSlots = () => db().all<Slot>("SELECT * FROM slots ORDER BY day, start");

export async function saveSlot(slot: Omit<Slot, "id"> & { id?: string }) {
  const id = slot.id ?? crypto.randomUUID();
  await db().run(
    `INSERT INTO slots (id, course_id, title, day, start, end, room) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET course_id = excluded.course_id, title = excluded.title, day = excluded.day,
       start = excluded.start, end = excluded.end, room = excluded.room`,
    [id, slot.course_id, slot.title, slot.day, slot.start, slot.end, slot.room],
  );
}

export const deleteSlot = (id: string) => db().run("DELETE FROM slots WHERE id = ?", [id]);

export const listGrades = () => db().all<Grade>("SELECT * FROM grades ORDER BY created_at");

export const addGrade = (g: Omit<Grade, "id" | "created_at">) =>
  db().run("INSERT INTO grades (id, course_id, title, score, out_of, weight, created_at) VALUES (?,?,?,?,?,?,?)", [
    crypto.randomUUID(),
    g.course_id,
    g.title,
    g.score,
    g.out_of,
    g.weight,
    Date.now(),
  ]);

export const deleteGrade = (id: string) => db().run("DELETE FROM grades WHERE id = ?", [id]);

/** Coefficients des matières, rangés dans `props` de leur page. */
export async function listCoefficients(): Promise<Record<string, number>> {
  const rows = await db().all<{ id: string; props: string | null }>(
    "SELECT id, props FROM pages WHERE kind = 'course'",
  );
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.props ? JSON.parse(r.props).coef : 1) || 1]));
}

export const setCoefficient = (courseId: string, coef: number) =>
  db().run("UPDATE pages SET props = ? WHERE id = ?", [JSON.stringify({ coef }), courseId]);

/** Moyenne pondérée sur 20, ou null sans note exploitable. */
export function average(grades: Pick<Grade, "score" | "out_of" | "weight">[]): number | null {
  let sum = 0;
  let weights = 0;
  for (const g of grades) {
    if (g.out_of <= 0 || g.weight <= 0) continue;
    sum += (g.score / g.out_of) * 20 * g.weight;
    weights += g.weight;
  }
  return weights ? sum / weights : null;
}

/** Moyenne générale : moyennes des matières pondérées par leur coefficient. */
export function overall(grades: Grade[], coefficients: Record<string, number>): number | null {
  const byCourse = new Map<string, Grade[]>();
  for (const g of grades) byCourse.set(g.course_id, [...(byCourse.get(g.course_id) ?? []), g]);
  return average(
    [...byCourse].flatMap(([course, list]) => {
      const avg = average(list);
      return avg === null ? [] : [{ score: avg, out_of: 20, weight: coefficients[course] ?? 1 }];
    }),
  );
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
