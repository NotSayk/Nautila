import { CalendarCheck, CalendarDays, Clock, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { cardStats } from "../data/cards";
import { listEvents } from "../data/events";
import { clock } from "../data/ical";
import { listSlots } from "../data/school";
import { listTasks, type Task } from "../data/tasks";
import { useT } from "../i18n";
import { useStore } from "../store";
import { daysUntil, formatDue, PageIcon, relativeTime, SectionTitle, TopBar } from "./common";

export function Dashboard() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [stats, setStats] = useState({ due: 0, total: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [classes, setClasses] = useState<
    { id: string; start: string; end: string; title: string; room: string; cancelled: boolean }[]
  >([]);

  useEffect(() => {
    cardStats().then(setStats);
    const today = (new Date().getDay() + 6) % 7;
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart).setDate(new Date(dayStart).getDate() + 1);
    // Créneaux de la semaine type et séances datées des calendriers importés.
    Promise.all([listSlots(), listEvents(dayStart, dayEnd)]).then(([slots, events]) =>
      setClasses(
        [
          ...slots
            .filter((x) => x.day === today)
            .map((x) => ({ id: x.id, start: x.start, end: x.end, title: x.title, room: x.room, cancelled: false })),
          ...events
            .filter((e) => !e.all_day)
            .map((e) => ({
              id: e.id,
              start: e.start < dayStart ? "00:00" : clock(e.start),
              end: e.end > dayEnd ? "23:59" : clock(e.end),
              title: e.title,
              room: e.room,
              cancelled: !!e.cancelled,
            })),
        ].sort((a, b) => a.start.localeCompare(b.start)),
      ),
    );
    listTasks().then((all) => setTasks(all.filter((x) => !x.done && x.due_at !== null && daysUntil(x.due_at) <= 14)));
  }, []);

  const hour = new Date().getHours();
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
          </section>
        </div>
      </div>
    </>
  );
}
