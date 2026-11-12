import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { addTask, deleteTask, listTasks, setTaskDone, type Task, type TaskKind } from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, View } from "./common";

const field = "rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function Tasks() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const courses = pages.filter((p) => p.kind === "course");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("homework");
  const [course, setCourse] = useState("");
  const [due, setDue] = useState("");

  const reload = () => listTasks().then(setTasks);
  useEffect(() => void reload(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await addTask({
      title: title.trim(),
      kind,
      course_id: course || null,
      // Midi, heure locale : la date choisie reste la même quel que soit le fuseau.
      due_at: due ? new Date(`${due}T12:00:00`).getTime() : null,
    });
    setTitle("");
    await reload();
  };

  const courseName = (id: string | null) => pages.find((p) => p.id === id)?.title;
  const open = tasks.filter((x) => !x.done);
  const done = tasks.filter((x) => x.done);

  const row = (task: Task) => {
    const late = !task.done && task.due_at !== null && daysUntil(task.due_at) < 0;
    return (
      <div key={task.id} className="group flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-hover">
        <input
          type="checkbox"
          checked={!!task.done}
          onChange={async (e) => {
            await setTaskDone(task.id, e.target.checked);
            await reload();
          }}
          className="size-4 accent-(--color-accent)"
        />
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            task.kind === "exam" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-accent-soft text-accent"
          }`}
        >
          {t(task.kind)}
        </span>
        <span className={`min-w-0 flex-1 truncate ${task.done ? "text-muted line-through" : ""}`}>{task.title}</span>
        <span className="hidden truncate text-muted sm:block">{courseName(task.course_id)}</span>
        {task.due_at !== null && (
          <span className={late ? "font-medium text-red-600 dark:text-red-400" : "text-muted"}>
            {late ? `${t("overdue")} · ` : ""}
            {formatDue(task.due_at, lang)}
          </span>
        )}
        <button
          aria-label={t("delete")}
          title={t("delete")}
          onClick={async () => {
            await deleteTask(task.id);
            await reload();
          }}
          className="grid size-6 place-items-center rounded text-muted opacity-0 hover:bg-line focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  return (
    <View title={t("tasks")}>
      <form onSubmit={submit} className="mb-8 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("taskTitle")}
          className={`${field} min-w-40 flex-1`}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className={field}>
          <option value="homework">{t("homework")}</option>
          <option value="exam">{t("exam")}</option>
        </select>
        <select value={course} onChange={(e) => setCourse(e.target.value)} className={field}>
          <option value="">{t("noCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || t("untitled")}
            </option>
          ))}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-bg">{t("add")}</button>
      </form>

      {tasks.length === 0 && <p className="text-sm text-muted">{t("noTasks")}</p>}
      {open.map(row)}
      {done.length > 0 && (
        <>
          <h2 className="mb-1 mt-8 text-xs font-semibold uppercase tracking-wide text-muted">{t("done")}</h2>
          {done.map(row)}
        </>
      )}
    </View>
  );
}
