import { ArrowLeft, BookOpenCheck, Keyboard, Layers, ListChecks, Puzzle, RefreshCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Grade } from "ts-fsrs";
import {
  addCard,
  cardStats,
  deckCards,
  deleteCard,
  dueCards,
  gradeCard,
  isExtraCard,
  listDecks,
  previewIntervals,
  type CardRow,
  type Deck,
} from "../data/cards";
import { deleteQuiz, listQuizzes, type Question, type Quiz } from "../data/quizzes";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { IconButton, PageIcon, SectionTitle, TopBar } from "./common";
import { ChoiceMode, FlipMode, MatchMode, questionsFromCards, WriteMode } from "./study/modes";

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

function interval(due: Date, now: Date, lang: string): string {
  const min = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43_200) return `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
  return `${Math.round(min / 43_200)} ${lang === "fr" ? "mois" : "mo"}`;
}

/** Révision espacée : les cartes dues, notées de « à revoir » à « facile ». */
function Spaced({ pageId, onExit }: { pageId?: string; onExit: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [queue, setQueue] = useState<CardRow[] | undefined>();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    dueCards(Date.now(), pageId).then(setQueue);
  }, [pageId]);

  const card = queue?.[0];
  const now = new Date();

  const grade = async (g: Grade) => {
    if (!card) return;
    await gradeCard(card, g, now);
    setRevealed(false);
    // Quand la file est vide, on avance les cartes dues dans les 10 minutes
    // (étapes d'apprentissage) pour finir la séance sans attendre.
    const next = await dueCards(Date.now(), pageId);
    setQueue(next.length ? next : await dueCards(Date.now() + 10 * 60_000, pageId));
    void useStore.getState().refreshDue();
  };

  // Espace ou Entrée : voir la réponse ; 1 à 4 : noter la carte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
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
        <div className="whitespace-pre-wrap px-8 py-14 text-center text-2xl font-semibold leading-snug">
          {card.front}
        </div>
        {revealed && (
          <div className="whitespace-pre-wrap px-8 py-10 text-center text-lg shadow-[inset_0_1px_0_var(--color-line)]">
            {card.back}
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
  const reload = useCallback(() => deckCards(pageId).then(setCards), [pageId]);
  useEffect(() => void reload(), [reload]);
  const due = cards.filter((c) => c.due <= Date.now()).length;
  const field = "h-8 min-w-0 flex-1 rounded-md bg-hover px-2 placeholder:text-faint";

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
        className="mb-2 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!front.trim() || !back.trim()) return;
          await addCard(pageId, front.trim(), back.trim());
          setFront("");
          setBack("");
          await reload();
          void useStore.getState().refreshDue();
        }}
      >
        <input
          value={front}
          onChange={(e) => setFront(e.target.value)}
          placeholder={t("question")}
          aria-label={t("question")}
          className={field}
        />
        <input
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder={t("answer")}
          aria-label={t("answer")}
          className={field}
        />
        <button className="h-8 rounded-md px-3 font-medium shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover">
          {t("addCard")}
        </button>
      </form>
      {cards.map((c) => (
        <div
          key={c.id}
          className="group grid grid-cols-[1fr_1fr_28px] items-start gap-3 py-2 shadow-[inset_0_-1px_0_var(--color-line)]"
        >
          <span className="whitespace-pre-wrap font-medium">{c.front}</span>
          <span className="whitespace-pre-wrap text-muted">{c.back}</span>
          {isExtraCard(c.id) ? (
            <IconButton
              label={t("delete")}
              className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
              onClick={async () => {
                await deleteCard(c.id);
                await reload();
                void useStore.getState().refreshDue();
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          ) : (
            <span title={t("fromNote")} className="pt-0.5 text-center text-xs text-faint">
              ↗
            </span>
          )}
        </div>
      ))}
    </>
  );
}

type Screen =
  | { name: "home" }
  | { name: "deck"; pageId: string }
  | { name: "study"; mode: Mode; cards: CardRow[]; pageId?: string; questions?: Question[] }
  | { name: "quiz"; quiz: Quiz };

export function Review() {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [decks, setDecks] = useState<Deck[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [stats, setStats] = useState({ due: 0, total: 0 });

  const reload = useCallback(() => {
    void listDecks().then(setDecks);
    void listQuizzes().then(setQuizzes);
    void cardStats().then(setStats);
  }, []);
  useEffect(() => {
    if (screen.name === "home") reload();
  }, [screen.name, reload]);

  const back = () =>
    setScreen(screen.name === "study" && screen.pageId ? { name: "deck", pageId: screen.pageId } : { name: "home" });
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

            {quizzes.length > 0 && (
              <>
                <SectionTitle>
                  <BookOpenCheck size={14} />
                  {t("quizzes")}
                </SectionTitle>
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
                    <IconButton
                      label={t("delete")}
                      className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                      onClick={async () => {
                        await deleteQuiz(quiz.id);
                        reload();
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
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
        {screen.name === "study" && screen.mode === "spaced" && <Spaced pageId={screen.pageId} onExit={back} />}
        {screen.name === "study" && screen.mode === "flip" && <FlipMode cards={screen.cards} onExit={back} />}
        {screen.name === "study" && screen.mode === "choice" && (
          <ChoiceMode questions={screen.questions ?? []} onExit={back} />
        )}
        {screen.name === "study" && screen.mode === "write" && <WriteMode cards={screen.cards} onExit={back} />}
        {screen.name === "study" && screen.mode === "match" && <MatchMode cards={screen.cards} onExit={back} />}
        {screen.name === "quiz" && <ChoiceMode questions={screen.quiz.questions} onExit={back} />}
      </div>
    </>
  );
}
