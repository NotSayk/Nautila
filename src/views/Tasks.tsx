import { CalendarClock, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addTask,
  deleteTask,
  listTasks,
  restoreTask,
  setTaskDone,
  updateTask,
  type Task,
  type TaskKind,
} from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, IconButton, View } from "./common";
import { notify } from "./dialogs";
import { openExamPlan } from "./study/ExamPlan";

const COLS =
  "grid grid-cols-[20px_minmax(0,1fr)_auto_auto_88px] items-center gap-3 sm:grid-cols-[20px_minmax(0,1fr)_84px_150px_120px_88px]";
const field = "h-8 rounded-md bg-transparent px-2 hover:bg-hover focus:bg-hover";
/** Midi, heure locale : la date choisie reste la même quel que soit le fuseau. */
const toTimestamp = (day: string) => (day ? new Date(`${day}T12:00:00`).getTime() : null);
const toDay = (ts: number | null) => (ts === null ? "" : new Date(ts).toLocaleDateString("sv-SE"));
const HIDE_UNTIL_HOVER = "opacity-0 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/** Ligne en cours de modification : titre, type, matière et date. */
function EditRow({ task, onDone }: { task: Task; onDone: (saved: boolean) => void }) {
  const t = useT();
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [title, setTitle] = useState(task.title);
  const [kind, setKind] = useState<TaskKind>(task.kind);
  const [course, setCourse] = useState(task.course_id ?? "");
  const [due, setDue] = useState(toDay(task.due_at));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await updateTask(task.id, { title: title.trim(), kind, course_id: course || null, due_at: toTimestamp(due) });
    onDone(true);
  };
  return (
    <form
      onSubmit={save}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onDone(false))}
      className="flex flex-wrap items-center gap-1 rounded-lg p-1 shadow-[0_0_0_1px_var(--color-line)]"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label={t("taskTitle")}
        className={`${field} min-w-40 flex-1`}
      />
      <select aria-label={t("type")} value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className={field}>
        <option value="homework">{t("homework")}</option>
        <option value="exam">{t("exam")}</option>
      </select>
      <select aria-label={t("course")} value={course} onChange={(e) => setCourse(e.target.value)} className={`${field} max-w-44`}>
        <option value="">{t("noCourse")}</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title || t("untitled")}
          </option>
        ))}
      </select>
      <input type="date" aria-label={t("dueDate")} value={due} onChange={(e) => setDue(e.target.value)} className={field} />
      <button className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95">{t("save")}</button>
      <button type="button" onClick={() => onDone(false)} className="h-8 rounded-md px-3 hover:bg-hover">
        {t("cancel")}
      </button>
    </form>
  );
}

export function Tasks() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const courses = pages.filter((p) => p.kind === "course");
  // null : chargement en cours (à distinguer de « aucun devoir »).
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("homework");
  const [course, setCourse] = useState("");
  const [due, setDue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const reload = () => listTasks().then(setTasks);
  useEffect(() => void reload(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await addTask({ title: title.trim(), kind, course_id: course || null, due_at: toTimestamp(due) });
    setTitle("");
    await reload();
  };

  const remove = async (task: Task) => {
    await deleteTask(task.id);
    await reload();
    // Suppression réversible : on propose d'annuler plutôt que de demander confirmation.
    notify(t("taskDeleted"), {
      action: {
        label: t("undoAction"),
        run: async () => {
          await restoreTask(task);
          await reload();
        },
      },
    });
  };

  const courseName = (id: string | null) => pages.find((p) => p.id === id)?.title;
  const open = (tasks ?? []).filter((x) => !x.done);
  const done = (tasks ?? []).filter((x) => x.done);

  const row = (task: Task) => {
    if (editing === task.id)
      return (
        <div key={task.id} className="py-1">
          <EditRow
            task={task}
            onDone={async (saved) => {
              setEditing(null);
              if (saved) {
                await reload();
                notify(t("taskUpdated"));
              }
            }}
          />
        </div>
      );
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
        <span className="flex">
          {task.kind === "exam" && !task.done && (
            <IconButton label={t("examPlan")} onClick={() => openExamPlan(task.id)} className={HIDE_UNTIL_HOVER}>
              <CalendarClock size={14} />
            </IconButton>
          )}
          <IconButton label={t("editTask")} onClick={() => setEditing(task.id)} className={HIDE_UNTIL_HOVER}>
            <Pencil size={14} />
          </IconButton>
          <IconButton label={t("delete")} onClick={() => remove(task)} className={HIDE_UNTIL_HOVER}>
            <Trash2 size={15} />
          </IconButton>
        </span>
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
        <select aria-label={t("type")} value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className={field}>
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
        <input type="date" aria-label={t("dueDate")} value={due} onChange={(e) => setDue(e.target.value)} className={field} />
        <button className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95">{t("newTask")}</button>
      </form>

      {tasks === null ? (
        <p role="status" className="text-muted">
          {t("loading")}
        </p>
      ) : tasks.length === 0 ? (
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
