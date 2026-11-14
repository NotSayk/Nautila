import { db } from "../db";
import { dayKey, keyNoon } from "./stats";

export type TaskKind = "homework" | "exam";
export type Recurrence = "daily" | "weekly" | "biweekly" | "monthly";
export const RECURRENCES: Recurrence[] = ["daily", "weekly", "biweekly", "monthly"];
export type Task = {
  id: string;
  title: string;
  kind: TaskKind;
  course_id: string | null;
  due_at: number | null;
  done: number;
  created_at: number;
  /** Absente (null) sur un devoir ponctuel ; une valeur inconnue est traitée comme ponctuelle. */
  recurrence: string | null;
};
type TaskInput = Pick<Task, "title" | "kind" | "course_id" | "due_at"> & { recurrence?: Recurrence | null };

export const isRecurrence = (value: unknown): value is Recurrence => RECURRENCES.includes(value as Recurrence);

/** Échéance `k` périodes après `start` (midi local) ; un mois trop court se borne à son dernier jour. */
function step(start: Date, recurrence: Recurrence, k: number): Date {
  if (recurrence === "monthly") {
    const last = new Date(start.getFullYear(), start.getMonth() + k + 1, 0).getDate();
    return new Date(start.getFullYear(), start.getMonth() + k, Math.min(start.getDate(), last), 12);
  }
  const days = { daily: 1, weekly: 7, biweekly: 14 }[recurrence] * k;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, 12);
}

/**
 * Échéance de l'occurrence suivante : au moins une période après la précédente, et après aujourd'hui
 * (un devoir en retard ne crée pas une série d'occurrences déjà passées). Sans date, on part d'aujourd'hui.
 */
export function nextDue(due: number | null, recurrence: Recurrence, now: number): number {
  const start = new Date(keyNoon(dayKey(due ?? now)));
  const today = dayKey(now);
  for (let k = 1; ; k++) {
    const next = step(start, recurrence, k);
    if (dayKey(next.getTime()) > today) return next.getTime();
  }
}

/** Identifiant déterministe de l'occurrence : deux appareils qui cochent le même devoir créent la même ligne. */
export const occurrenceId = (id: string, due: number) => `${id.replace(/@\d{4}-\d{2}-\d{2}$/, "")}@${dayKey(due)}`;

export const listTasks = () => db().all<Task>("SELECT * FROM tasks ORDER BY done, due_at IS NULL, due_at, created_at");

export async function addTask(input: TaskInput) {
  await db().run(
    "INSERT INTO tasks (id, title, kind, course_id, due_at, done, created_at, recurrence) VALUES (?,?,?,?,?,0,?,?)",
    [crypto.randomUUID(), input.title, input.kind, input.course_id, input.due_at, Date.now(), input.recurrence ?? null],
  );
}

/**
 * Coche ou décoche un devoir. Cocher un devoir récurrent crée l'occurrence suivante (sans doublon) ;
 * le décocher aussitôt retire cette occurrence tant qu'elle n'a pas été faite. Renvoie l'occurrence créée.
 */
export async function setTaskDone(task: Task, done: boolean, now = Date.now()): Promise<string | null> {
  const recurrence = isRecurrence(task.recurrence) ? task.recurrence : null;
  if (!recurrence) {
    await db().run("UPDATE tasks SET done = ? WHERE id = ?", [done ? 1 : 0, task.id]);
    return null;
  }
  const due = nextDue(task.due_at, recurrence, now);
  const next = occurrenceId(task.id, due);
  await db().batch([
    { sql: "UPDATE tasks SET done = ? WHERE id = ?", params: [done ? 1 : 0, task.id] },
    done
      ? {
          sql: `INSERT OR IGNORE INTO tasks (id, title, kind, course_id, due_at, done, created_at, recurrence)
                VALUES (?,?,?,?,?,0,?,?)`,
          params: [next, task.title, task.kind, task.course_id, due, now, recurrence],
        }
      : { sql: "DELETE FROM tasks WHERE id = ? AND done = 0", params: [next] },
  ]);
  return done ? next : null;
}

export const deleteTask = (id: string) => db().run("DELETE FROM tasks WHERE id = ?", [id]);

/** Modifie le titre, le type, la matière, l'échéance et la récurrence d'un devoir. */
export const updateTask = (id: string, patch: TaskInput) =>
  db().run("UPDATE tasks SET title = ?, kind = ?, course_id = ?, due_at = ?, recurrence = ? WHERE id = ?", [
    patch.title,
    patch.kind,
    patch.course_id,
    patch.due_at,
    patch.recurrence ?? null,
    id,
  ]);

/** Remet un devoir supprimé tel quel (annulation de la suppression). */
export const restoreTask = (task: Task) =>
  db().run(
    "INSERT OR REPLACE INTO tasks (id, title, kind, course_id, due_at, done, created_at, recurrence) VALUES (?,?,?,?,?,?,?,?)",
    [task.id, task.title, task.kind, task.course_id, task.due_at, task.done, task.created_at, task.recurrence ?? null],
  );
