import { ClipboardCheck, Timer } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { gradeCard, listDecks, type Deck } from "../../data/cards";
import { drawQuestions, isCorrect, loadPool, retryMinutes, scoreMock, type MockAnswer, type MockQuestion } from "../../data/mock";
import { subtreeIds } from "../../data/plan";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { confirmDialog, notify } from "../dialogs";
import { CardFront, MathText } from "./CardText";

const PRIMARY =
  "h-9 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95 disabled:cursor-default disabled:bg-active disabled:text-faint";
const SECONDARY = "h-9 rounded-md px-4 font-medium shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover disabled:opacity-40";
const CARD = "rounded-xl bg-pop shadow-[0_0_0_1px_var(--color-line),0_2px_8px_rgb(0_0_0/0.05)]";
const field = "h-8 w-full rounded-md bg-hover px-2";

type Settings = { count: number; minutes: number; fsrs: boolean };
type Run = { questions: MockQuestion[]; minutes: number; fsrs: boolean };

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Réglages : source (si elle n'est pas imposée), nombre de questions, durée, effet sur la planification. */
function Setup({
  pageIds,
  title,
  onStart,
}: {
  pageIds?: string[];
  title?: string;
  onStart: (pool: MockQuestion[], settings: Settings) => void;
}) {
  const t = useT();
  const id = useId();
  const pages = useStore((s) => s.pages);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [source, setSource] = useState("");
  const [pool, setPool] = useState<MockQuestion[] | null>(null);
  const [count, setCount] = useState(20);
  const [minutes, setMinutes] = useState(20);
  const [fsrs, setFsrs] = useState(false);
  useEffect(() => void listDecks().then(setDecks), []);

  // Sources proposées : chaque matière (avec ses sous-pages) et chaque paquet.
  const sources = useMemo(() => {
    const courses = pages
      .filter((p) => p.kind === "course")
      .map((p) => ({ key: `course:${p.id}`, label: `${t("course")} : ${p.title || t("untitled")}`, ids: subtreeIds(pages, p.id) }));
    const deckRows = decks.flatMap((d) => {
      const page = pages.find((p) => p.id === d.page_id);
      return page ? [{ key: `deck:${d.page_id}`, label: `${t("deck")} : ${page.title || t("untitled")}`, ids: [d.page_id] }] : [];
    });
    return [...courses, ...deckRows];
  }, [pages, decks, t]);
  const chosen = pageIds ?? sources.find((s) => s.key === source)?.ids ?? sources[0]?.ids;
  const key = chosen?.join(",") ?? "";

  useEffect(() => {
    setPool(null);
    void loadPool(key ? key.split(",") : []).then(setPool);
  }, [key]);

  const n = Math.min(count, pool?.length ?? 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pool?.length) onStart(pool, { count: n, minutes, fsrs });
      }}
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        <ClipboardCheck size={14} />
        {t("mockExam")}
      </p>
      <h1 className="mb-2 text-[26px] font-bold leading-tight">{title ?? t("mockExam")}</h1>
      <p className="mb-6 text-muted">{t("mockIntro")}</p>
      <div className="grid max-w-md gap-4">
        {!pageIds && (
          <label className="block text-xs text-muted">
            {t("mockSource")}
            <select value={source} onChange={(e) => setSource(e.target.value)} className={`${field} mt-1 text-sm text-ink`}>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-muted">
            {t("mockCount")}
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
              className={`${field} mt-1 text-sm text-ink tabular-nums`}
            />
          </label>
          <label className="block text-xs text-muted">
            {t("mockMinutes")}
            <input
              type="number"
              min={1}
              max={300}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))}
              className={`${field} mt-1 text-sm text-ink tabular-nums`}
            />
          </label>
        </div>
        <p id={`${id}-pool`} className="text-muted" role="status">
          {pool === null ? t("loading") : pool.length === 0 ? t("mockEmpty") : `${pool.length} ${t("mockAvailable")} · ${n} ${t("mockDrawn")}`}
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={fsrs} onChange={(e) => setFsrs(e.target.checked)} className="mt-0.5 size-4 accent-(--color-accent)" />
          <span>
            {t("mockFsrs")}
            <span className="block text-xs text-muted">{t("mockFsrsHint")}</span>
          </span>
        </label>
        <div>
          <button className={PRIMARY} disabled={!pool?.length} aria-describedby={`${id}-pool`}>
            {t("mockStart")}
          </button>
        </div>
      </div>
    </form>
  );
}

/** L'épreuve : chronométrée, sans correction ; on peut revenir sur une question avant de terminer. */
function Exam({ run, onFinish }: { run: Run; onFinish: (answers: MockAnswer[], spent: number) => void }) {
  const t = useT();
  const { questions } = run;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<MockAnswer[]>(() => questions.map(() => null));
  const started = useRef(Date.now()).current;
  const deadline = started + run.minutes * 60_000;
  const [now, setNow] = useState(Date.now());
  const finished = useRef(false);
  const q = questions[index];
  const answered = answers.filter((a) => a !== null && a !== "").length;

  const finish = (list = answers) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(list, Math.min(Date.now(), deadline) - started);
  };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (now < deadline) return;
    notify(t("mockTimeUp"));
    finish();
  });

  const set = (value: MockAnswer) => setAnswers((list) => list.map((a, i) => (i === index ? value : a)));
  const left = deadline - now;
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-muted tabular-nums">
          {t("question")} {index + 1} / {questions.length}
        </span>
        <span
          role="timer"
          aria-label={t("mockTimeLeft")}
          className={`flex items-center gap-1.5 font-medium tabular-nums ${left < 60_000 ? "text-danger" : ""}`}
        >
          <Timer size={15} />
          {clock(left)}
        </span>
      </div>
      <nav aria-label={t("mockQuestions")} className="mb-5 flex flex-wrap gap-1">
        {questions.map((_, i) => {
          const done = answers[i] !== null && answers[i] !== "";
          return (
            <button
              key={i}
              type="button"
              aria-current={i === index ? "step" : undefined}
              aria-label={`${t("question")} ${i + 1}${done ? ` (${t("mockAnswered")})` : ""}`}
              onClick={() => setIndex(i)}
              className={`grid size-7 place-items-center rounded text-xs tabular-nums ${
                i === index
                  ? "bg-accent text-white"
                  : done
                    ? "bg-active font-medium"
                    : "shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>

      <div className={`${CARD} whitespace-pre-wrap px-8 py-10 text-center text-xl font-semibold`}>
        {q.kind === "choice" ? <MathText text={q.prompt} /> : <CardFront card={q.card} />}
      </div>
      {q.kind === "choice" ? (
        <div role="radiogroup" aria-label={t("mockChoices")} className="mt-4 grid gap-2 sm:grid-cols-2">
          {q.choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={answers[index] === i}
              onClick={() => set(answers[index] === i ? null : i)}
              className={`flex min-h-12 items-center gap-3 whitespace-pre-wrap rounded-lg px-4 py-2.5 text-left ${
                answers[index] === i
                  ? "bg-accent/15 shadow-[0_0_0_2px_var(--color-accent)]"
                  : "shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
              }`}
            >
              <span className="text-xs font-semibold text-faint">{i + 1}</span>
              <span className="min-w-0">
                <MathText text={choice} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <input
          key={q.key}
          autoFocus
          value={typeof answers[index] === "string" ? (answers[index] as string) : ""}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && index < questions.length - 1) {
              e.preventDefault();
              setIndex(index + 1);
            }
          }}
          placeholder={t("yourAnswer")}
          aria-label={t("yourAnswer")}
          className="mt-4 h-10 w-full rounded-md bg-hover px-3 placeholder:text-faint"
        />
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <span className="flex gap-2">
          <button type="button" className={SECONDARY} disabled={index === 0} onClick={() => setIndex(index - 1)}>
            ← {t("mockPrev")}
          </button>
          <button
            type="button"
            className={SECONDARY}
            disabled={index === questions.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            {t("mockNext")} →
          </button>
        </span>
        <button
          type="button"
          className={PRIMARY}
          onClick={async () => {
            const missing = questions.length - answered;
            if (
              missing > 0 &&
              !(await confirmDialog({ message: `${missing} ${t("mockUnanswered")}`, confirmLabel: t("mockFinish") }))
            )
              return;
            finish();
          }}
        >
          {t("mockFinish")}
        </button>
      </div>
    </>
  );
}

/** Bilan : score, temps, questions ratées avec la bonne réponse ; relance des seules erreurs. */
function Report({
  run,
  answers,
  spent,
  onRetry,
  onAgain,
  onExit,
}: {
  run: Run;
  answers: MockAnswer[];
  spent: number;
  onRetry: (wrong: MockQuestion[]) => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const t = useT();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const result = scoreMock(run.questions, answers, accepted);
  const percent = Math.round((result.score / Math.max(1, result.total)) * 100);

  // Option « planification » : chaque carte posée est notée une fois, en quittant le bilan
  // (une réponse déclarée juste entre-temps compte comme juste).
  const graded = useRef(false);
  const latest = useRef({ result, answers });
  latest.current = { result, answers };
  const commit = () => {
    if (!run.fsrs || graded.current) return;
    graded.current = true;
    const { result } = latest.current;
    void (async () => {
      for (const [i, q] of run.questions.entries())
        if (q.kind === "card" && latest.current.answers[i] !== null) await gradeCard(q.card, result.right[i] ? 3 : 1);
      await useStore.getState().refreshDue();
    })();
  };
  // Bilan quitté autrement (barre du haut) : la notation part quand même. Le délai laisse passer le
  // double montage du mode strict de React, qui démonte puis remonte aussitôt.
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => !alive.current && commit(), 0);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (q: MockQuestion, a: MockAnswer) =>
    a === null || a === "" ? t("mockNoAnswer") : q.kind === "choice" ? q.choices[a as number] ?? "" : String(a);
  return (
    <>
      <div className="pt-[4vh] text-center">
        <p className="text-muted">{t("score")}</p>
        <p className="mt-1 text-5xl font-bold tabular-nums">
          {result.score} <span className="text-2xl font-medium text-faint">/ {result.total}</span>
        </p>
        <p className="mt-2 text-muted">
          {percent} % · {t("time")} : {clock(spent)}
          {run.fsrs && ` · ${t("mockFsrsDone")}`}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button autoFocus={result.wrong.length === 0} className={SECONDARY} onClick={() => (commit(), onExit())}>
            {t("mockBack")}
          </button>
          <button className={SECONDARY} onClick={() => (commit(), onAgain())}>
            {t("mockAgain")}
          </button>
          {result.wrong.length > 0 && (
            <button autoFocus className={PRIMARY} onClick={() => (commit(), onRetry(result.wrong))}>
              {t("mockRetryWrong")} ({result.wrong.length})
            </button>
          )}
        </div>
      </div>

      {result.wrong.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-xs font-medium text-muted">{t("mockMissed")}</h2>
          {run.questions.map((q, i) => {
            if (result.right[i]) return null;
            const a = answers[i] ?? null;
            return (
              <div key={q.key} className="py-3 shadow-[inset_0_-1px_0_var(--color-line)]">
                <p className="whitespace-pre-wrap font-medium">
                  {q.kind === "choice" ? <MathText text={q.prompt} /> : <CardFront card={q.card} />}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted">{t("mockYourAnswer")} : </span>
                  <span className="text-danger">
                    <MathText text={show(q, a)} />
                  </span>
                </p>
                <p className="text-sm">
                  <span className="text-muted">{t("expected")} : </span>
                  <span className="font-medium text-[#2b593f] dark:text-[#7fc79c]">
                    <MathText text={q.kind === "choice" ? q.choices[q.answer] : q.expected} />
                  </span>
                </p>
                {q.kind === "choice" && q.explanation && (
                  <p className="mt-1 text-sm text-muted">
                    <MathText text={q.explanation} />
                  </p>
                )}
                {q.kind === "card" && typeof a === "string" && a.trim() && !isCorrect(q, a) && (
                  <button
                    className="mt-1 h-7 rounded-md px-2 text-xs text-muted hover:bg-hover"
                    onClick={() => setAccepted((s) => new Set(s).add(q.key))}
                  >
                    {t("iWasRight")}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

/** Examen blanc depuis une matière, un paquet ou un examen. N'influence la planification que sur demande. */
export function MockExamView({ pageIds, title, onExit }: { pageIds?: string[]; title?: string; onExit: () => void }) {
  const [phase, setPhase] = useState<
    | { name: "setup" }
    | { name: "run"; run: Run; pool: MockQuestion[]; settings: Settings; round: number }
    | { name: "report"; run: Run; pool: MockQuestion[]; settings: Settings; answers: MockAnswer[]; spent: number }
  >({ name: "setup" });

  const start = (pool: MockQuestion[], settings: Settings, questions = drawQuestions(pool, settings.count), minutes = settings.minutes) =>
    setPhase({ name: "run", run: { questions, minutes, fsrs: settings.fsrs }, pool, settings, round: Date.now() });

  if (phase.name === "setup") return <Setup pageIds={pageIds} title={title} onStart={(pool, settings) => start(pool, settings)} />;
  if (phase.name === "run")
    return (
      <Exam
        key={phase.round}
        run={phase.run}
        onFinish={(answers, spent) => setPhase({ ...phase, name: "report", answers, spent })}
      />
    );
  return (
    <Report
      run={phase.run}
      answers={phase.answers}
      spent={phase.spent}
      onExit={onExit}
      onAgain={() => start(phase.pool, phase.settings)}
      onRetry={(wrong) =>
        start(phase.pool, phase.settings, wrong, retryMinutes(phase.run.minutes, phase.run.questions.length, wrong.length))
      }
    />
  );
}
