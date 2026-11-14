import {
  ArrowLeft,
  BookOpenCheck,
  Brackets,
  CalendarClock,
  ChartColumn,
  Download,
  Keyboard,
  Layers,
  ListChecks,
  Pencil,
  Plus,
  Puzzle,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade } from "ts-fsrs";
import { parseAnkiText, toAnkiText } from "../data/anki";
import { download } from "../data/backup";
import {
  addCard,
  addCards,
  cardStats,
  deckCards,
  deleteCard,
  dueCards,
  expandLooseClozes,
  gradeCard,
  isExtraCard,
  listDecks,
  parseCardList,
  previewIntervals,
  updateCard,
  type CardRow,
  type Deck,
} from "../data/cards";
import { clozeOf, groupNotes, hasCloze, wrapCloze } from "../data/cloze";
import { createPage } from "../data/pages";
import { examSessionCards, upcomingExams } from "../data/plan";
import { listTasks, type Task } from "../data/tasks";
import { cleanQuestions, deleteQuiz, listQuizzes, saveQuiz, type Question, type Quiz } from "../data/quizzes";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { daysUntil, IconButton, PageIcon, SectionTitle, TopBar, useOverlay } from "./common";
import { confirmDialog, notify } from "./dialogs";
import { CardFront, ClozeText, MathText } from "./study/CardText";
import { ChoiceMode, FlipMode, MatchMode, questionsFromCards, WriteMode } from "./study/modes";
import { StatsView } from "./study/Stats";
import { daysLeftLabel, ExamPlanView, useStudyIntent } from "./study/ExamPlan";

const GRADES: [Grade, Key][] = [
  [1, "again"],
  [2, "hard"],
  [3, "good"],
  [4, "easy"],
];
type Mode = "spaced" | "flip" | "choice" | "write" | "match";
const MODES: [Mode, Key, Key, typeof Layers][] = [
  ["spaced", "modeSpaced", "modeSpacedSub", RefreshCcw],
  ["flip", "modeFlip", "modeFlipSub", Layers],
  ["choice", "modeChoice", "modeChoiceSub", ListChecks],
  ["write", "modeWrite", "modeWriteSub", Keyboard],
  ["match", "modeMatch", "modeMatchSub", Puzzle],
];
const PRIMARY =
  "h-9 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95 disabled:cursor-default disabled:bg-active disabled:text-faint";
const SHELL = "mx-auto max-w-[760px] px-6 pb-24 pt-8";
const SECONDARY = "flex h-8 items-center gap-1.5 rounded-md px-3 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover";
const area = "min-w-0 resize-y rounded-md bg-hover px-2 py-1.5 placeholder:text-faint";
const input = "h-8 w-full min-w-0 rounded-md bg-hover px-2 placeholder:text-faint";

/** Ctrl+Entrée (ou ⌘+Entrée) valide le formulaire depuis une zone de texte. */
function submitOnCtrlEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
}

/**
 * Bouton « Trou » : entoure la sélection du champ visé de `{{cN::…}}`. Le clic ne prend pas le focus,
 * pour garder la sélection ; le curseur est ensuite replacé dans le champ.
 */
function ClozeButton({
  target,
  value,
  onChange,
}: {
  target: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      title={t("clozeButtonHint")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const el = target.current;
        const at = el ? { a: el.selectionStart, b: el.selectionEnd } : { a: value.length, b: value.length };
        const next = wrapCloze(value, at.a, at.b);
        onChange(next.text);
        requestAnimationFrame(() => {
          el?.focus();
          el?.setSelectionRange(next.start, next.end);
        });
      }}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-hover"
    >
      <Brackets size={14} />
      {t("clozeButton")}
    </button>
  );
}

/** Choix de la page qui portera un nouveau paquet : une page existante, ou une page créée pour l'occasion. */
function NewDeckDialog({ onClose, onPick }: { onClose: () => void; onPick: (pageId: string) => void }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [query, setQuery] = useState("");
  useOverlay(onClose);
  const q = query.trim().toLowerCase();
  const list = pages
    .filter((p) => p.kind !== "database" && (!q || (p.title || "").toLowerCase().includes(q)))
    .slice(0, 50);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-label={t("newDeck")}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-3 rounded-xl bg-pop p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!query.trim()) return;
          const page = await createPage({ title: query.trim(), icon: "🗂️" });
          await useStore.getState().refreshPages();
          onPick(page.id);
        }}
      >
        <div>
          <p className="font-semibold">{t("newDeck")}</p>
          <p className="text-sm text-muted">{t("newDeckHint")}</p>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("newDeckPlaceholder")}
          aria-label={t("newDeckPlaceholder")}
          className={input}
        />
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto">
          {query.trim() && (
            <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover">
              <Plus size={16} className="text-muted" />
              <span className="truncate">
                {t("newDeckCreate")} « <span className="font-medium">{query.trim()}</span> »
              </span>
            </button>
          )}
          {list.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => onPick(p.id)}
              className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
            >
              <PageIcon page={p} size={16} />
              <span className="truncate">{p.title || t("untitled")}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

const blankQuestion = (): Question => ({ question: "", choices: ["", "", "", ""], answer: 0, explanation: "" });

/** Création et modification d'un quiz à choix multiples. */
function QuizEditor({ quiz, onDone }: { quiz: Quiz | null; onDone: () => void }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [title, setTitle] = useState(quiz?.title ?? "");
  const [pageId, setPageId] = useState(quiz?.page_id ?? "");
  const [questions, setQuestions] = useState<Question[]>(() =>
    quiz ? quiz.questions.map((q) => ({ ...q, choices: [...q.choices], explanation: q.explanation ?? "" })) : [blankQuestion()],
  );
  const [tried, setTried] = useState(false);
  const clean = cleanQuestions(questions);
  const set = (i: number, patch: Partial<Question>) =>
    setQuestions((list) => list.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setTried(true);
        if (!title.trim() || !clean) return;
        await saveQuiz({
          id: quiz?.id ?? crypto.randomUUID(),
          page_id: pageId || null,
          title: title.trim(),
          questions: clean,
          created_at: quiz?.created_at ?? Date.now(),
        });
        onDone();
      }}
    >
      <h1 className="mb-6 text-[26px] font-bold leading-tight">{t(quiz ? "editQuiz" : "newQuiz")}</h1>
      <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="block text-xs text-muted">
          {t("quizTitle")}
          <input
            autoFocus={!quiz}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`${input} mt-1 text-sm text-ink`}
          />
        </label>
        <label className="block text-xs text-muted">
          {t("quizPage")}
          <select
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            className={`${input} mt-1 text-sm text-ink`}
          >
            <option value="">—</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || t("untitled")}
              </option>
            ))}
          </select>
        </label>
      </div>

      {questions.map((q, i) => {
        const incomplete = tried && !cleanQuestions([q]);
        return (
          <fieldset
            key={i}
            className={`mb-4 rounded-lg p-3 shadow-[0_0_0_1px_var(--color-line)] ${incomplete ? "shadow-[0_0_0_1px_var(--color-danger)]" : ""}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <legend className="flex-1 text-xs font-medium text-muted">
                {t("question")} {i + 1}
              </legend>
              {questions.length > 1 && (
                <IconButton
                  label={t("removeQuestion")}
                  onClick={() => setQuestions((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
            <textarea
              value={q.question}
              onChange={(e) => set(i, { question: e.target.value })}
              rows={2}
              placeholder={t("question")}
              aria-label={`${t("question")} ${i + 1}`}
              className={`${area} w-full`}
            />
            <p className="mb-1 mt-2 text-xs text-muted">{t("quizChoicesHint")}</p>
            {q.choices.map((choice, c) => (
              <div key={c} className="mb-1.5 flex items-center gap-2">
                <input
                  type="radio"
                  name={`answer-${i}`}
                  checked={q.answer === c}
                  onChange={() => set(i, { answer: c })}
                  aria-label={`${t("correctAnswer")} ${c + 1}`}
                />
                <input
                  value={choice}
                  onChange={(e) => set(i, { choices: q.choices.map((x, k) => (k === c ? e.target.value : x)) })}
                  placeholder={`${t("choice")} ${c + 1}`}
                  aria-label={`${t("choice")} ${c + 1}`}
                  className={`${input} ${q.answer === c ? "ring-1 ring-accent" : ""}`}
                />
                {q.choices.length > 2 && (
                  <IconButton
                    label={t("removeChoice")}
                    onClick={() =>
                      set(i, {
                        choices: q.choices.filter((_, k) => k !== c),
                        answer: q.answer === c ? 0 : q.answer > c ? q.answer - 1 : q.answer,
                      })
                    }
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
            {q.choices.length < 6 && (
              <button
                type="button"
                className="mb-2 h-7 rounded-md px-2 text-muted hover:bg-hover"
                onClick={() => set(i, { choices: [...q.choices, ""] })}
              >
                + {t("addChoice")}
              </button>
            )}
            <input
              value={q.explanation ?? ""}
              onChange={(e) => set(i, { explanation: e.target.value })}
              placeholder={t("explanationOptional")}
              aria-label={t("explanationOptional")}
              className={input}
            />
          </fieldset>
        );
      })}
      <button type="button" className={SECONDARY} onClick={() => setQuestions((list) => [...list, blankQuestion()])}>
        <Plus size={15} />
        {t("addQuestion")}
      </button>

      <div className="mt-8 flex items-center justify-end gap-2">
        {tried && (!title.trim() || !clean) && <p className="mr-auto text-sm text-danger">{t("quizIncomplete")}</p>}
        <button type="button" className="h-9 rounded-md px-4 hover:bg-hover" onClick={onDone}>
          {t("cancel")}
        </button>
        <button className={PRIMARY}>{t("save")}</button>
      </div>
    </form>
  );
}

function interval(due: Date, now: Date, lang: string): string {
  const min = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43_200) return `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
  return `${Math.round(min / 43_200)} ${lang === "fr" ? "mois" : "mo"}`;
}

/**
 * Révision espacée : les cartes dues, notées de « à revoir » à « facile ». Avec `pageIds` (révision
 * pour un examen), les cartes dues de ces pages d'abord, puis leurs nouvelles cartes.
 */
function Spaced({ pageId, pageIds, onExit }: { pageId?: string; pageIds?: string[]; onExit: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [queue, setQueue] = useState<CardRow[] | undefined>();
  const [revealed, setRevealed] = useState(false);
  const load = useCallback(
    (at: number) => (pageIds ? examSessionCards(pageIds, at) : dueCards(at, pageId)),
    [pageId, pageIds],
  );

  useEffect(() => {
    void load(Date.now()).then(setQueue);
  }, [load]);

  const card = queue?.[0];
  const now = new Date();
  // Temps de réponse : depuis l'affichage de la carte jusqu'à la note (au-delà de 10 min, non significatif).
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
  }, [card?.id, queue]);

  // Verrou : un double appui ne note pas deux fois la même carte.
  const grading = useRef(false);
  const grade = async (g: Grade) => {
    if (!card || grading.current) return;
    grading.current = true;
    try {
      const spent = Date.now() - shownAt.current;
      await gradeCard(card, g, now, spent <= 600_000 ? spent : null);
      setRevealed(false);
      // Quand la file est vide, on avance les cartes dues dans les 10 minutes
      // (étapes d'apprentissage) pour finir la séance sans attendre.
      const next = await load(Date.now());
      setQueue(next.length ? next : await load(Date.now() + 10 * 60_000));
      void useStore.getState().refreshDue();
    } finally {
      grading.current = false;
    }
  };

  // Espace ou Entrée : voir la réponse ; 1 à 4 : noter la carte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.repeat || target.closest("input, textarea, select")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        // Sur un bouton ou un lien, la touche garde son effet habituel.
        if (target.closest("button, a, [role=button], [role=link]")) return;
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && /^[1-4]$/.test(e.key)) void grade(Number(e.key) as Grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!queue) return null;
  if (!card)
    return (
      <div className="pt-[12vh] text-center">
        <p className="text-xl font-semibold">{t("reviewDone")}</p>
        <p className="mt-2 text-muted">{t("reviewDoneSub")}</p>
        <button className={`${PRIMARY} mt-6`} onClick={onExit}>
          {t("continue")}
        </button>
      </div>
    );

  const preview = previewIntervals(card, now);
  const source = pages.find((p) => p.id === card.page_id);
  const { cloze } = clozeOf(card);
  return (
    <>
      <p className="mb-3 text-right text-xs text-faint">
        {queue.length} {t("remaining")}
      </p>
      {source && (
        <button
          title={t("openSource")}
          onClick={() => navigate({ view: "page", id: source.id })}
          className="mx-auto mb-4 flex h-7 items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
        >
          <PageIcon page={source} size={16} />
          {source.title || t("untitled")}
        </button>
      )}
      <div className="rounded-xl bg-pop shadow-[0_0_0_1px_var(--color-line),0_2px_8px_rgb(0_0_0/0.05)]">
        {/* Carte à trous : le recto dévoilé remplace le recto, et le verso facultatif vient dessous. */}
        <div className="whitespace-pre-wrap px-8 py-14 text-center text-2xl font-semibold leading-snug">
          {revealed && cloze ? <ClozeText text={card.front} gap={clozeOf(card).n} reveal /> : <CardFront card={card} />}
        </div>
        {revealed && (!cloze || card.back.trim()) && (
          <div className="whitespace-pre-wrap px-8 py-10 text-center text-lg shadow-[inset_0_1px_0_var(--color-line)]">
            <MathText text={card.back} />
          </div>
        )}
      </div>
      {revealed ? (
        <div className="mt-5 grid grid-cols-4 gap-2">
          {GRADES.map(([g, key]) => (
            <button
              key={g}
              onClick={() => grade(g)}
              className="rounded-md py-2 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
            >
              <span className="block font-medium">{t(key)}</span>
              <span className="block text-xs text-faint">{interval(preview[g], now, lang)}</span>
            </button>
          ))}
        </div>
      ) : (
        <button autoFocus onClick={() => setRevealed(true)} className={`${PRIMARY} mt-5 w-full`}>
          {t("showAnswer")}
        </button>
      )}
    </>
  );
}

/** Écran d'un paquet : choix du mode d'étude et liste des cartes. */
function DeckView({ pageId, onStart }: { pageId: string; onStart: (mode: Mode, cards: CardRow[]) => void }) {
  const t = useT();
  const page = useStore((s) => s.pages.find((p) => p.id === pageId));
  const navigate = useStore((s) => s.navigate);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [editing, setEditing] = useState<{ id: string; front: string; back: string } | null>(null);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const bulkRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const ankiInput = useRef<HTMLInputElement>(null);
  const reload = useCallback(() => deckCards(pageId).then(setCards), [pageId]);
  useEffect(() => void reload(), [reload]);
  const due = cards.filter((c) => c.due <= Date.now()).length;
  const notes = groupNotes(cards);
  const complete = (f: string, b: string) => !!f.trim() && (!!b.trim() || hasCloze(f));

  const importAnki = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const list = parseAnkiText(await file.text());
    if (!list.length) return notify(t("ankiNothing"));
    await addCards(pageId, list);
    await reload();
    void useStore.getState().refreshDue();
    notify(`${list.length} ${t("ankiImported")}`);
  };
  const exportAnki = () =>
    download(
      `${(page?.title || t("untitled")).replace(/[\\/:*?"<>|]+/g, "_")}.txt`,
      toAnkiText(notes.map((n) => ({ front: n.front, back: n.back }))),
      "text/plain",
    );

  return (
    <>
      <button
        onClick={() => page && navigate({ view: "page", id: page.id })}
        className="mb-1 flex items-center gap-2 rounded px-1 text-[26px] font-bold hover:bg-hover"
      >
        {page && <PageIcon page={page} size={26} />}
        {page?.title || t("untitled")}
      </button>
      <p className="mb-6 px-1 text-muted">
        {cards.length} {t("cardsCount")} · {due} {t("dueCount")}
      </p>
      <div className="mb-8 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        {MODES.map(([mode, label, sub, Icon]) => {
          const disabled =
            mode === "spaced"
              ? due === 0
              : cards.length === 0 || ((mode === "choice" || mode === "match") && cards.length < 4);
          return (
            <button
              key={mode}
              disabled={disabled}
              title={disabled && cards.length < 4 && mode !== "spaced" ? t("needMoreCards") : undefined}
              onClick={() => onStart(mode, cards)}
              className="flex items-center gap-3 rounded-lg bg-pop p-3 text-left shadow-[0_0_0_1px_var(--color-line)] enabled:hover:bg-hover disabled:opacity-45"
            >
              <Icon size={20} strokeWidth={1.75} className="shrink-0 text-muted" />
              <span>
                <span className="block font-medium">{t(label)}</span>
                <span className="block text-xs text-muted">
                  {mode === "spaced" ? `${due} ${t("dueCount")}` : t(sub)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <SectionTitle>{t("allCards")}</SectionTitle>
      <form
        className="mb-2 rounded-lg p-2 shadow-[0_0_0_1px_var(--color-line)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (bulk) {
            const list = parseCardList(bulkText);
            if (!list.length) return;
            await addCards(pageId, list);
            setBulkText("");
            setBulk(false);
          } else {
            if (!complete(front, back)) return;
            await addCard(pageId, front.trim(), back.trim());
            setFront("");
            setBack("");
            frontRef.current?.focus();
          }
          await reload();
          void useStore.getState().refreshDue();
        }}
      >
        {bulk ? (
          <>
            <textarea
              autoFocus
              ref={bulkRef}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={t("bulkPlaceholder")}
              aria-label={t("bulkImport")}
              className={`${area} w-full`}
            />
            <p className="mt-1 text-xs text-muted">
              {t("bulkHint")} · {parseCardList(bulkText).length} {t("cardsCount")}
            </p>
          </>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <textarea
              ref={frontRef}
              value={front}
              onChange={(e) => setFront(e.target.value)}
              onKeyDown={submitOnCtrlEnter}
              rows={2}
              placeholder={t("question")}
              aria-label={t("question")}
              className={area}
            />
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              onKeyDown={submitOnCtrlEnter}
              rows={2}
              placeholder={hasCloze(front) ? t("answerOptional") : t("answer")}
              aria-label={t("answer")}
              className={area}
            />
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            className="h-8 rounded-md px-2 text-muted hover:bg-hover"
            onClick={() => setBulk(!bulk)}
          >
            {t(bulk ? "addOneCard" : "bulkImport")}
          </button>
          {bulk ? (
            <ClozeButton target={bulkRef} value={bulkText} onChange={setBulkText} />
          ) : (
            <ClozeButton target={frontRef} value={front} onChange={setFront} />
          )}
          <span className="flex-1" />
          <button
            disabled={bulk ? parseCardList(bulkText).length === 0 : !complete(front, back)}
            className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95 disabled:opacity-40"
          >
            {t(bulk ? "addCards" : "addCard")}
          </button>
        </div>
        <p className="mt-1 px-1 text-xs text-muted">{t("clozeHint")}</p>
      </form>
      <div className="mb-2 flex flex-wrap justify-end gap-1">
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-hover" onClick={() => ankiInput.current?.click()}>
          <Upload size={14} />
          {t("ankiImport")}
        </button>
        <button
          type="button"
          disabled={cards.length === 0}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted enabled:hover:bg-hover disabled:opacity-45"
          onClick={exportAnki}
        >
          <Download size={14} />
          {t("ankiExport")}
        </button>
        <input ref={ankiInput} type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" hidden onChange={importAnki} />
      </div>
      {cards.length === 0 && <p className="py-4 text-muted">{t("deckEmpty")}</p>}
      {notes.map((c) =>
        editing?.id === c.id ? (
          <form
            key={c.id}
            className="grid gap-2 py-2 shadow-[inset_0_-1px_0_var(--color-line)] sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!complete(editing.front, editing.back)) return;
              await updateCard(c.id, editing.front.trim(), editing.back.trim());
              setEditing(null);
              await reload();
              void useStore.getState().refreshDue();
            }}
          >
            <textarea
              autoFocus
              ref={editRef}
              value={editing.front}
              onChange={(e) => setEditing({ ...editing, front: e.target.value })}
              onKeyDown={submitOnCtrlEnter}
              rows={2}
              aria-label={t("question")}
              className={area}
            />
            <textarea
              value={editing.back}
              onChange={(e) => setEditing({ ...editing, back: e.target.value })}
              onKeyDown={submitOnCtrlEnter}
              rows={2}
              aria-label={t("answer")}
              className={area}
            />
            <div className="flex justify-end gap-2 sm:col-span-2">
              <ClozeButton target={editRef} value={editing.front} onChange={(front) => setEditing({ ...editing, front })} />
              <span className="flex-1" />
              <button type="button" className="h-8 rounded-md px-3 hover:bg-hover" onClick={() => setEditing(null)}>
                {t("cancel")}
              </button>
              <button className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95">
                {t("save")}
              </button>
            </div>
          </form>
        ) : (
          <div
            key={c.id}
            className="group grid grid-cols-[1fr_1fr_auto] items-start gap-3 py-2 shadow-[inset_0_-1px_0_var(--color-line)]"
          >
            <span className="min-w-0 whitespace-pre-wrap break-words font-medium">
              <ClozeText text={c.front} />
              {c.gaps > 1 && (
                <span className="ml-2 whitespace-nowrap align-middle text-xs font-normal text-faint">
                  {c.gaps} {t("clozeCount")}
                </span>
              )}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words text-muted">
              <MathText text={c.back} />
            </span>
            {isExtraCard(c.id) ? (
              <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                <IconButton label={t("edit")} onClick={() => setEditing({ id: c.id, front: c.front, back: c.back })}>
                  <Pencil size={14} />
                </IconButton>
                <IconButton
                  label={t("delete")}
                  onClick={async () => {
                    await deleteCard(c.id);
                    await reload();
                    void useStore.getState().refreshDue();
                  }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </span>
            ) : (
              <button
                title={t("fromNote")}
                onClick={() => navigate({ view: "page", id: pageId })}
                className="grid h-7 w-14 place-items-center rounded text-xs text-faint hover:bg-hover"
              >
                ↗
              </button>
            )}
          </div>
        ),
      )}
    </>
  );
}

type Screen =
  | { name: "home" }
  | { name: "deck"; pageId: string }
  | {
      name: "study";
      mode: Mode;
      cards: CardRow[];
      pageId?: string;
      questions?: Question[];
      /** Révision pour un examen : pages de la matière, et examen auquel revenir. */
      pageIds?: string[];
      examId?: string;
    }
  | { name: "exam"; taskId: string }
  | { name: "quiz"; quiz: Quiz }
  | { name: "editQuiz"; quiz: Quiz | null }
  | { name: "stats" };

export function Review() {
  const t = useT();
  const pages = useStore((s) => s.pages);
  // Ouverture depuis l'accueil ou les devoirs : directement sur le plan d'un examen.
  const [screen, setScreen] = useState<Screen>(() => {
    const exam = useStudyIntent.getState().exam;
    useStudyIntent.setState({ exam: null });
    return exam ? { name: "exam", taskId: exam } : { name: "home" };
  });
  const [exams, setExams] = useState<Task[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [stats, setStats] = useState({ due: 0, total: 0 });
  const [newDeck, setNewDeck] = useState(false);

  const reload = useCallback(async () => {
    // Cartes à trous arrivées d'un seul tenant (connecteur MCP) : un trou par entrée planifiée.
    if (await expandLooseClozes().catch(() => 0)) void useStore.getState().refreshDue();
    void listDecks().then(setDecks);
    void listTasks().then((all) => setExams(upcomingExams(all)));
    void listQuizzes().then(setQuizzes);
    void cardStats().then(setStats);
  }, []);
  useEffect(() => {
    if (screen.name === "home") reload();
  }, [screen.name, reload]);

  const back = () =>
    setScreen(
      screen.name === "study" && screen.examId
        ? { name: "exam", taskId: screen.examId }
        : screen.name === "study" && screen.pageId
          ? { name: "deck", pageId: screen.pageId }
          : { name: "home" },
    );
  const title = (id: string | null) => pages.find((p) => p.id === id);

  return (
    <>
      <TopBar>
        {screen.name !== "home" && (
          <IconButton label={t("back")} onClick={back}>
            <ArrowLeft size={18} strokeWidth={1.75} />
          </IconButton>
        )}
        <span className="px-1.5">{t("review")}</span>
      </TopBar>
      <div className={SHELL}>
        {screen.name === "home" && (
          <>
            <h1 className="mb-6 text-[30px] font-bold leading-tight">{t("review")}</h1>
            <div className="mb-10 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl bg-panel px-5 py-4">
              <div>
                <p className="text-[32px] font-bold leading-none tabular-nums">{stats.due}</p>
                <p className="mt-1 text-muted">{t("cardsDue")}</p>
              </div>
              <p className="text-muted">
                {stats.total} {t("cardsTotal")}
              </p>
              <button
                disabled={stats.due === 0}
                className={`${PRIMARY} ml-auto`}
                onClick={() => setScreen({ name: "study", mode: "spaced", cards: [] })}
              >
                {t("startReview")}
              </button>
            </div>

            <div className="mb-8 flex flex-wrap gap-2">
              <button className={SECONDARY} onClick={() => setNewDeck(true)}>
                <Plus size={15} />
                {t("newDeck")}
              </button>
              <button className={SECONDARY} onClick={() => setScreen({ name: "editQuiz", quiz: null })}>
                <Plus size={15} />
                {t("newQuiz")}
              </button>
              <button className={SECONDARY} onClick={() => setScreen({ name: "stats" })}>
                <ChartColumn size={15} />
                {t("statsTitle")}
              </button>
            </div>

            {exams.length > 0 && (
              <>
                <SectionTitle>
                  <CalendarClock size={14} />
                  {t("upcomingExams")}
                </SectionTitle>
                <div className="mb-10">
                  {exams.map((exam) => (
                    <button
                      key={exam.id}
                      onClick={() => setScreen({ name: "exam", taskId: exam.id })}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left shadow-[inset_0_-1px_0_var(--color-line)] hover:bg-hover"
                    >
                      <span className="tag tag-red">{t("exam")}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{exam.title}</span>
                      <span className="truncate text-muted max-sm:hidden">{title(exam.course_id)?.title}</span>
                      <span className="text-muted">{daysLeftLabel(daysUntil(exam.due_at!), t)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <SectionTitle>
              <Layers size={14} />
              {t("decks")}
            </SectionTitle>
            {decks.length === 0 && <p className="mb-8 text-muted">{t("noDecks")}</p>}
            <div className="mb-10">
              {decks.map((d) => {
                const page = title(d.page_id);
                return (
                  page && (
                    <button
                      key={d.page_id}
                      onClick={() => setScreen({ name: "deck", pageId: d.page_id })}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-left shadow-[inset_0_-1px_0_var(--color-line)] hover:bg-hover"
                    >
                      <PageIcon page={page} />
                      <span className="min-w-0 flex-1 truncate font-medium">{page.title || t("untitled")}</span>
                      <span className="text-muted">
                        {d.total} {t("cardsCount")}
                      </span>
                      {d.due > 0 && (
                        <span className="tag tag-blue">
                          {d.due} {t("dueCount")}
                        </span>
                      )}
                    </button>
                  )
                );
              })}
            </div>

            <SectionTitle>
              <BookOpenCheck size={14} />
              {t("quizzes")}
            </SectionTitle>
            {quizzes.length === 0 && <p className="text-muted">{t("noQuizzes")}</p>}
            {quizzes.length > 0 && (
              <>
                {quizzes.map((quiz) => (
                  <div
                    key={quiz.id}
                    className="group flex min-h-11 items-center gap-2 rounded-md px-2 shadow-[inset_0_-1px_0_var(--color-line)] hover:bg-hover"
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left"
                      onClick={() => setScreen({ name: "quiz", quiz })}
                    >
                      <ListChecks size={18} strokeWidth={1.75} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate font-medium">{quiz.title}</span>
                      <span className="truncate text-muted max-sm:hidden">{title(quiz.page_id)?.title}</span>
                      <span className="text-muted">
                        {quiz.questions.length} {t("questionsCount")}
                      </span>
                    </button>
                    <span className="flex opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
                      <IconButton label={t("edit")} onClick={() => setScreen({ name: "editQuiz", quiz })}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={t("delete")}
                        onClick={async () => {
                          if (!(await confirmDialog({ message: t("confirmDeleteQuiz"), confirmLabel: t("delete"), danger: true }))) return;
                          await deleteQuiz(quiz.id);
                          reload();
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {screen.name === "deck" && (
          <DeckView
            pageId={screen.pageId}
            onStart={(mode, cards) =>
              setScreen({
                name: "study",
                mode,
                cards,
                pageId: screen.pageId,
                // Tirées une fois pour toutes : l'ordre ne doit pas changer en cours de partie.
                questions: mode === "choice" ? questionsFromCards(cards) : undefined,
              })
            }
          />
        )}
        {screen.name === "study" && screen.mode === "spaced" && (
          <Spaced pageId={screen.pageId} pageIds={screen.pageIds} onExit={back} />
        )}
        {screen.name === "exam" && (
          <ExamPlanView
            key={screen.taskId}
            taskId={screen.taskId}
            onReview={(pageIds) => setScreen({ name: "study", mode: "spaced", cards: [], pageIds, examId: screen.taskId })}
          />
        )}
        {screen.name === "study" && screen.mode === "flip" && <FlipMode cards={screen.cards} onExit={back} />}
        {screen.name === "study" && screen.mode === "choice" && (
          <ChoiceMode questions={screen.questions ?? []} onExit={back} />
        )}
        {screen.name === "study" && screen.mode === "write" && <WriteMode cards={screen.cards} onExit={back} />}
        {screen.name === "study" && screen.mode === "match" && <MatchMode cards={screen.cards} onExit={back} />}
        {screen.name === "quiz" && <ChoiceMode questions={screen.quiz.questions} onExit={back} />}
        {screen.name === "editQuiz" && <QuizEditor quiz={screen.quiz} onDone={() => setScreen({ name: "home" })} />}
        {screen.name === "stats" && <StatsView />}
      </div>
      {newDeck && (
        <NewDeckDialog
          onClose={() => setNewDeck(false)}
          onPick={(pageId) => {
            setNewDeck(false);
            setScreen({ name: "deck", pageId });
          }}
        />
      )}
    </>
  );
}
