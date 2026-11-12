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
