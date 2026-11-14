import { AlertTriangle, CalendarClock, ClipboardCheck, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { loadExamPlan, type ExamDetail } from "../../data/plan";
import { listTasks, type Task } from "../../data/tasks";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { PageIcon, SectionTitle } from "../common";

/**
 * Demande d'ouvrir un écran précis des révisions depuis un autre écran (accueil, devoirs) :
 * Révisions la lit à son ouverture puis l'efface.
 */
export const useStudyIntent = create<{ exam: string | null }>(() => ({ exam: null }));

/** Ouvre le plan de révision d'un examen. */
export function openExamPlan(taskId: string) {
  useStudyIntent.setState({ exam: taskId });
  useStore.getState().navigate({ view: "review" });
}

const PRIMARY =
  "flex h-9 items-center gap-2 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95 disabled:cursor-default disabled:bg-active disabled:text-faint";
const SECONDARY =
  "flex h-9 items-center gap-2 rounded-md px-4 shadow-[0_0_0_1px_var(--color-line)] enabled:hover:bg-hover disabled:cursor-default disabled:opacity-45";

/** « Aujourd'hui », « Demain » ou « dans N jours ». */
export function daysLeftLabel(days: number, t: ReturnType<typeof useT>) {
  if (days <= 0) return t("today");
  if (days === 1) return t("tomorrow");
  return `${t("inDays")} ${days} ${t("daysLong")}`;
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <p className="text-[26px] font-bold leading-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** Plan de révision d'un examen : charge quotidienne, détail par page et séance limitée à la matière. */
export function ExamPlanView({
  taskId,
  onReview,
  onMock,
}: {
  taskId: string;
  onReview: (pageIds: string[]) => void;
  onMock?: (pageIds: string[], title: string) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [task, setTask] = useState<Task | null | undefined>();
  const [detail, setDetail] = useState<ExamDetail | null | undefined>();

  useEffect(() => {
    void listTasks().then(async (all) => {
      const found = all.find((x) => x.id === taskId) ?? null;
      setTask(found);
      setDetail(found ? await loadExamPlan(found, useStore.getState().pages) : null);
    });
  }, [taskId]);

  if (task === undefined || detail === undefined)
    return (
      <p role="status" className="text-muted">
        {t("loading")}
      </p>
    );
  if (!task) return <p className="text-muted">{t("examMissing")}</p>;

  const course = pages.find((p) => p.id === task.course_id);
  const date =
    task.due_at === null
      ? ""
      : new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(task.due_at);
  const plan = detail?.plan;
  const past = plan ? plan.until < 0 : false;
  const startable = !!detail && detail.byPage.some((p) => p.total > 0);

  return (
    <>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        <CalendarClock size={14} />
        {t("examPlan")}
      </p>
      <h1 className="mb-1 text-[26px] font-bold leading-tight">{task.title}</h1>
      <p className="mb-6 text-muted">
        {course && (
          <>
            <span className="inline-flex items-center gap-1 align-middle">
              <PageIcon page={course} size={14} />
              {course.title || t("untitled")}
            </span>
            {" · "}
          </>
        )}
        {date}
        {plan && !past && ` · ${daysLeftLabel(plan.until, t)}`}
      </p>

      {!detail ? (
        <div className="rounded-xl bg-panel p-4">
          <p>{t(task.due_at === null ? "examNoDate" : "examNoCourse")}</p>
          <button className={`${SECONDARY} mt-3`} onClick={() => navigate({ view: "tasks" })}>
            {t("tasks")}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-xl bg-panel p-4 sm:grid-cols-4">
            <Figure value={detail.plan.fresh} label={t("examFresh")} />
            <Figure value={detail.plan.due} label={t("examDue")} />
            <Figure value={past ? "—" : detail.plan.days} label={t("examDaysLeft")} />
            <Figure value={past ? "—" : detail.plan.perDay} label={t("examPerDay")} />
          </div>
          {past ? (
            <p className="mb-6 text-muted">{t("examPast")}</p>
          ) : detail.plan.total === 0 ? (
            <p className="mb-6 text-muted">{t(startable ? "examAllDone" : "examNoCards")}</p>
          ) : (
            <p className="mb-6 text-muted">
              {t("examLoad")} <strong className="font-semibold text-ink">{detail.plan.perDay}</strong> {t("cardsPerDay")} (≈{" "}
              {detail.plan.minutes} min). {t("examLoadHint")}
            </p>
          )}
          {!past && detail.plan.heavy && (
            <div
              role="alert"
              className="mb-6 flex gap-2.5 rounded-lg bg-[#fbf3db] px-3 py-2.5 text-[#402c1b] dark:bg-[#564328] dark:text-white/85"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{t("examHeavy")}</p>
            </div>
          )}
          <div className="mb-8 flex flex-wrap gap-2">
            <button className={PRIMARY} disabled={!startable} onClick={() => onReview(detail.pageIds)}>
              <RefreshCcw size={15} />
              {t("examReview")}
            </button>
            {onMock && (
              <button className={SECONDARY} disabled={!startable} onClick={() => onMock(detail.pageIds, task.title)}>
                <ClipboardCheck size={15} />
                {t("mockExam")}
              </button>
            )}
          </div>

          <SectionTitle>{t("examByPage")}</SectionTitle>
          {detail.byPage.length === 0 && <p className="text-muted">{t("examNoCards")}</p>}
          {detail.byPage.map((row) => {
            const page = pages.find((p) => p.id === row.page_id);
            return (
              <div key={row.page_id} className="flex min-h-10 items-center gap-2.5 px-1 shadow-[inset_0_-1px_0_var(--color-line)]">
                {page && <PageIcon page={page} />}
                <span className="min-w-0 flex-1 truncate font-medium">{page?.title || t("untitled")}</span>
                <span className="text-muted">
                  {row.total} {t("cardsCount")}
                </span>
                {row.fresh > 0 && (
                  <span className="tag tag-blue">
                    {row.fresh} {t("statsNew").toLowerCase()}
                  </span>
                )}
                {row.due > 0 && (
                  <span className="tag tag-red">
                    {row.due} {t("dueBefore")}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
