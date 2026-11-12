import { useEffect, useState } from "react";
import { cardStats } from "../data/cards";
import { listTasks, type Task } from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, PageIcon, View } from "./common";

export function Dashboard() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [stats, setStats] = useState({ due: 0, total: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    cardStats().then(setStats);
    listTasks().then((all) => setTasks(all.filter((x) => !x.done && x.due_at !== null && daysUntil(x.due_at) <= 14)));
  }, []);

  const recent = [...pages].sort((a, b) => b.updated_at - a.updated_at).slice(0, 6);
  const courseName = (id: string | null) => pages.find((p) => p.id === id)?.title;

  return (
    <View title={t("welcome")}>
      <p className="-mt-4 mb-8 text-muted">{t("welcomeSub")}</p>

      <div className="mb-10 flex flex-wrap items-center gap-6 rounded-xl border border-line p-5">
        <div>
          <p className="text-3xl font-bold text-accent">{stats.due}</p>
          <p className="text-sm text-muted">{t("cardsDue")}</p>
        </div>
        <div>
          <p className="text-3xl font-bold">{stats.total}</p>
          <p className="text-sm text-muted">{t("cardsTotal")}</p>
        </div>
        {stats.due > 0 && (
          <button
            onClick={() => navigate({ view: "review" })}
            className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg"
          >
            {t("startReview")}
          </button>
        )}
      </div>

      <h2 className="mb-2 font-semibold">{t("upcoming")}</h2>
      <div className="mb-10">
        {tasks.length === 0 && <p className="text-sm text-muted">{t("nothingUpcoming")}</p>}
        {tasks.map((task) => {
          const late = daysUntil(task.due_at!) < 0;
          return (
            <button
              key={task.id}
              onClick={() => navigate({ view: "tasks" })}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-hover"
            >
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                  task.kind === "exam" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-accent-soft text-accent"
                }`}
              >
                {t(task.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
              <span className="truncate text-muted">{courseName(task.course_id)}</span>
              <span className={late ? "font-medium text-red-600 dark:text-red-400" : "text-muted"}>
                {late ? t("overdue") : formatDue(task.due_at!, lang)}
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mb-2 font-semibold">{t("recent")}</h2>
      {recent.length === 0 && <p className="text-sm text-muted">{t("noRecent")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {recent.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate({ view: "page", id: p.id })}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:bg-hover"
          >
            <PageIcon page={p} />
            <span className="truncate">{p.title || t("untitled")}</span>
          </button>
        ))}
      </div>
    </View>
  );
}
