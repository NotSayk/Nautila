import { db } from "../db";

export type TaskKind = "homework" | "exam";
export type Task = {
  id: string;
  title: string;
  kind: TaskKind;
  course_id: string | null;
  due_at: number | null;
  done: number;
  created_at: number;
};

export const listTasks = () => db().all<Task>("SELECT * FROM tasks ORDER BY done, due_at IS NULL, due_at, created_at");

export async function addTask(input: Pick<Task, "title" | "kind" | "course_id" | "due_at">) {
  await db().run("INSERT INTO tasks (id, title, kind, course_id, due_at, done, created_at) VALUES (?,?,?,?,?,0,?)", [
    crypto.randomUUID(),
    input.title,
    input.kind,
    input.course_id,
    input.due_at,
    Date.now(),
  ]);
}

export const setTaskDone = (id: string, done: boolean) =>
  db().run("UPDATE tasks SET done = ? WHERE id = ?", [done ? 1 : 0, id]);

export const deleteTask = (id: string) => db().run("DELETE FROM tasks WHERE id = ?", [id]);

/** Modifie le titre, le type, la matière et l'échéance d'un devoir. */
export const updateTask = (id: string, patch: Pick<Task, "title" | "kind" | "course_id" | "due_at">) =>
  db().run("UPDATE tasks SET title = ?, kind = ?, course_id = ?, due_at = ? WHERE id = ?", [
    patch.title,
    patch.kind,
    patch.course_id,
    patch.due_at,
    id,
  ]);

/** Remet un devoir supprimé tel quel (annulation de la suppression). */
export const restoreTask = (task: Task) =>
  db().run("INSERT OR REPLACE INTO tasks (id, title, kind, course_id, due_at, done, created_at) VALUES (?,?,?,?,?,?,?)", [
    task.id,
    task.title,
    task.kind,
    task.course_id,
    task.due_at,
    task.done,
    task.created_at,
  ]);
