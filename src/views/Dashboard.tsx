import { CalendarCheck, CalendarClock, CalendarDays, Clock, Flame, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { cardStats } from "../data/cards";
import { upcomingExams } from "../data/plan";
import { openExamPlan } from "./study/ExamPlan";
import { dailyGoal, reviewSummary, setDailyGoal } from "../data/stats";
import { dayClasses, listEvents, type DayClass } from "../data/events";
import { listSlots } from "../data/school";
import { listTasks, type Task } from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, PageIcon, relativeTime, SectionTitle, TopBar } from "./common";

type Summary = Awaited<ReturnType<typeof reviewSummary>>;

/** Série de jours de révision et objectif du jour (nombre de cartes, réglable). */
function DailyGoal({ summary }: { summary: Summary | null }) {
  const t = useT();
  const [goal, setGoal] = useState(dailyGoal);
  const [editing, setEditing] = useState(false);
  if (!summary) return null;
  const done = summary.reviewedToday;
  const reached = done >= goal;
  return (
    <div className="mt-3 rounded-xl bg-panel p-4">
      <p className="flex items-center gap-1.5 font-medium">
        <Flame size={16} className={summary.current > 0 ? "text-[#d9730d]" : "text-faint"} aria-hidden />
        {summary.current} {t(summary.current > 1 ? "daysLong" : "dayLong")}
        <span className="font-normal text-muted">· {t("streak").toLowerCase()}</span>
      </p>
      <p className="text-xs text-muted">
        {t("streakBest")} : {summary.best}
        {summary.current > 0 && !summary.today && ` · ${t("streakKeep")}`}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-muted">{t("dailyGoal")}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{done}</span> / {goal}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("dailyGoal")}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(done, goal)}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full ${reached ? "bg-[#448361] dark:bg-[#5fae83]" : "bg-accent"}`}
          style={{ width: `${Math.min(100, (done / goal) * 100)}%` }}
        />
      </div>
      {reached && <p className="mt-1.5 text-xs text-muted">{t("goalReached")}</p>}
      {editing ? (
        <form
          className="mt-3 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(new FormData(e.currentTarget).get("goal"));
            if (value > 0) {
              setDailyGoal(value);
              setGoal(dailyGoal());
            }
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(false))}
        >
          <input
            autoFocus
            name="goal"
            type="number"
            min={1}
            max={999}
            defaultValue={goal}
            aria-label={t("dailyGoalCards")}
            className="h-7 w-20 rounded-md bg-hover px-2 tabular-nums"
          />
          <button className="h-7 rounded-md bg-accent px-2.5 font-medium text-white hover:brightness-95">{t("save")}</button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-2 h-7 rounded-md px-1.5 text-xs text-muted hover:bg-hover">
          {t("editGoal")}
        </button>
      )}
    </div>
  );
}

export function Dashboard() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [stats, setStats] = useState({ due: 0, total: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [classes, setClasses] = useState<DayClass[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exams, setExams] = useState<Task[]>([]);
  // Jour courant : relu chaque minute pour que l'accueil suive le changement de jour.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const dayStart = new Date(now).setHours(0, 0, 0, 0);

  useEffect(() => {
    cardStats().then(setStats);
    reviewSummary().then(setSummary);
    const dayEnd = new Date(dayStart).setDate(new Date(dayStart).getDate() + 1);
    const weekday = (new Date(dayStart).getDay() + 6) % 7;
    // Créneaux de la semaine type et séances datées des calendriers importés, sans doublon.
    Promise.all([listSlots(), listEvents(dayStart, dayEnd)]).then(([slots, events]) =>
      setClasses(dayClasses(slots, events, dayStart, dayEnd, weekday)),
    );
    listTasks().then((all) => {
      setTasks(all.filter((x) => !x.done && x.due_at !== null && daysUntil(x.due_at) <= 14));
      setExams(upcomingExams(all).slice(0, 4));
    });
  }, [dayStart]);

  const hour = new Date(now).getHours();
  const greeting = t(hour < 12 ? "goodMorning" : hour < 18 ? "goodAfternoon" : "goodEvening");
  const recent = [...pages].sort((a, b) => b.updated_at - a.updated_at).slice(0, 8);
  const courseName = (id: string | null) => pages.find((p) => p.id === id)?.title;

  return (
    <>
      <TopBar>
        <span className="px-1.5">{t("home")}</span>
      </TopBar>
      <div className="mx-auto max-w-[900px] px-(--page-pad) pb-24">
        <h1 className="py-12 text-center text-[30px] font-bold">{greeting}</h1>

        <SectionTitle>
          <Clock size={14} />
          {t("recent")}
        </SectionTitle>
        {recent.length === 0 ? (
          <p className="mb-10 rounded-xl bg-panel px-4 py-6 text-center text-muted">{t("noRecent")}</p>
        ) : (
          <div className="-mx-1 mb-10 flex gap-4 overflow-x-auto px-1 pb-2">
            {recent.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate({ view: "page", id: p.id })}
                className="flex h-36 w-36 shrink-0 flex-col overflow-hidden rounded-xl bg-pop text-left shadow-[0_0_0_1px_var(--color-line),0_2px_4px_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_0_0_1px_var(--color-line),0_4px_12px_rgb(0_0_0/0.1)]"
              >
                <span className="h-11 w-full bg-panel" />
                <span className="-mt-3.5 ml-4">
                  <PageIcon page={p} size={26} />
                </span>
                <span className="mt-2.5 line-clamp-2 px-4 font-medium leading-5">{p.title || t("untitled")}</span>
                <span className="mt-auto px-4 pb-3 text-xs text-faint">{relativeTime(p.updated_at, lang)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_260px]">
          <section>
            {classes.length > 0 && (
              <>
                <SectionTitle>
                  <CalendarDays size={14} />
                  {t("todayClasses")}
                </SectionTitle>
                <div className="mb-8 rounded-xl bg-panel p-1.5">
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate({ view: "timetable" })}
                      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-hover"
                    >
                      <span className="w-24 shrink-0 tabular-nums text-muted">
                        {c.start} – {c.end}
                      </span>
                      <span className={`min-w-0 flex-1 truncate font-medium ${c.cancelled ? "text-muted line-through" : ""}`}>
                        {c.title}
                      </span>
                      <span className="truncate text-muted">{c.room}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {exams.length > 0 && (
              <>
                <SectionTitle>
                  <CalendarClock size={14} />
                  {t("upcomingExams")}
                </SectionTitle>
                <div className="mb-8 grid gap-2 sm:grid-cols-2">
                  {exams.map((exam) => {
                    const days = daysUntil(exam.due_at!);
                    return (
                      <button
                        key={exam.id}
                        onClick={() => openExamPlan(exam.id)}
                        title={t("examPlan")}
                        className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 text-left hover:bg-hover"
                      >
                        <span className="grid w-12 shrink-0 place-items-center">
                          {days === 0 ? (
                            <span className="text-base font-bold text-danger">{t("todayShort")}</span>
                          ) : (
                            <>
                              <span className="text-[26px] font-bold leading-none tabular-nums">{days}</span>
                              <span className="text-[11px] text-muted">{t(days > 1 ? "daysLong" : "dayLong")}</span>
                            </>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{exam.title}</span>
                          <span className="block truncate text-xs text-muted">
                            {[courseName(exam.course_id), formatDue(exam.due_at!, lang)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <SectionTitle>
              <CalendarCheck size={14} />
              {t("upcoming")}
            </SectionTitle>
            <div className="rounded-xl bg-panel p-1.5">
              {tasks.length === 0 && <p className="px-2.5 py-5 text-center text-muted">{t("nothingUpcoming")}</p>}
              {tasks.map((task) => {
                const late = daysUntil(task.due_at!) < 0;
                return (
                  <button
                    key={task.id}
                    onClick={() => navigate({ view: "tasks" })}
                    className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-hover"
                  >
                    <span className={`tag ${task.kind === "exam" ? "tag-red" : "tag-blue"}`}>{t(task.kind)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                    <span className="hidden truncate text-muted sm:block">{courseName(task.course_id)}</span>
                    <span className={late ? "text-danger" : "text-muted"}>
                      {late ? t("overdue") : formatDue(task.due_at!, lang)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <SectionTitle>
              <Layers size={14} />
              {t("review")}
            </SectionTitle>
            <div className="rounded-xl bg-panel p-4">
              <p className="text-[32px] font-bold leading-none tabular-nums">{stats.due}</p>
              <p className="mt-1.5 text-muted">{t("cardsDue")}</p>
              <p className="text-xs text-faint">
                {stats.total} {t("cardsTotal")}
              </p>
              <button
                disabled={stats.due === 0}
                onClick={() => navigate({ view: "review" })}
                className="mt-4 h-8 w-full rounded-md bg-accent font-medium text-white hover:brightness-95 disabled:cursor-default disabled:bg-active disabled:text-faint"
              >
                {t("startReview")}
              </button>
            </div>
            <DailyGoal summary={summary} />
          </section>
        </div>
      </div>
    </>
  );
}
