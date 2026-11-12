import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { addTask, deleteTask, listTasks, setTaskDone, type Task, type TaskKind } from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, IconButton, View } from "./common";

const COLS =
  "grid grid-cols-[20px_minmax(0,1fr)_auto_auto_28px] items-center gap-3 sm:grid-cols-[20px_minmax(0,1fr)_84px_150px_120px_28px]";
const field = "h-8 rounded-md bg-transparent px-2 hover:bg-hover focus:bg-hover";

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
      <div key={task.id} className={`${COLS} group min-h-10 shadow-[inset_0_-1px_0_var(--color-line)]`}>
        <input
          type="checkbox"
          aria-label={task.title}
          checked={!!task.done}
          onChange={async (e) => {
            await setTaskDone(task.id, e.target.checked);
            await reload();
          }}
          className="size-4 accent-(--color-accent)"
        />
        <span className={`truncate font-medium ${task.done ? "text-faint line-through" : ""}`}>{task.title}</span>
        <span>
          <span className={`tag ${task.kind === "exam" ? "tag-red" : "tag-blue"}`}>{t(task.kind)}</span>
        </span>
        <span className="truncate text-muted max-sm:hidden">{courseName(task.course_id)}</span>
        <span className={`whitespace-nowrap ${late ? "text-danger" : "text-muted"}`}>
          {task.due_at !== null && formatDue(task.due_at, lang)}
        </span>
        <IconButton
          label={t("delete")}
          onClick={async () => {
            await deleteTask(task.id);
            await reload();
          }}
          className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
    );
  };

  return (
    <View title={t("tasks")}>
      <form
        onSubmit={submit}
        className="mb-8 flex flex-wrap items-center gap-1 rounded-lg p-1 shadow-[0_0_0_1px_var(--color-line)]"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("taskTitle")}
          aria-label={t("taskTitle")}
          className={`${field} min-w-40 flex-1 placeholder:text-faint`}
        />
        <select
          aria-label={t("type")}
          value={kind}
          onChange={(e) => setKind(e.target.value as TaskKind)}
          className={field}
        >
          <option value="homework">{t("homework")}</option>
          <option value="exam">{t("exam")}</option>
        </select>
        <select
          aria-label={t("course")}
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className={`${field} max-w-44`}
        >
          <option value="">{t("noCourse")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || t("untitled")}
            </option>
          ))}
        </select>
        <input
          type="date"
          aria-label={t("dueDate")}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className={field}
        />
        <button className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95">
          {t("newTask")}
        </button>
      </form>

      {tasks.length === 0 ? (
        <p className="text-muted">{t("noTasks")}</p>
      ) : (
        <div className={`${COLS} h-8 text-xs text-faint shadow-[inset_0_-1px_0_var(--color-line)]`}>
          <span />
          <span>{t("taskTitle")}</span>
          <span>{t("type")}</span>
          <span className="max-sm:hidden">{t("course")}</span>
          <span>{t("dueDate")}</span>
          <span />
        </div>
      )}
      {open.map(row)}
      {done.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-xs font-medium text-muted">{t("done")}</h2>
          {done.map(row)}
        </>
      )}
    </View>
  );
}
