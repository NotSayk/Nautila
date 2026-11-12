import { useEffect, useMemo, useState } from "react";
import type { CardRow } from "../../data/cards";
import type { Question } from "../../data/quizzes";
import { choicesFor, sameAnswer, shuffle } from "../../data/study";
import { useT } from "../../i18n";

const PRIMARY = "h-9 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95 disabled:opacity-40";
const SECONDARY = "h-9 rounded-md px-4 font-medium shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover";
const CARD = "rounded-xl bg-pop shadow-[0_0_0_1px_var(--color-line),0_2px_8px_rgb(0_0_0/0.05)]";
type ModeProps = { cards: CardRow[]; onExit: () => void };

function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="mb-1.5 text-right text-xs tabular-nums text-faint">
        {Math.min(index + 1, total)} / {total}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-hover">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${(index / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Result({
  score,
  total,
  extra,
  onRestart,
  onExit,
}: {
  score: number;
  total: number;
  extra?: string;
  onRestart: () => void;
  onExit: () => void;
}) {
  const t = useT();
  return (
    <div className="pt-[10vh] text-center">
      <p className="text-muted">{t("score")}</p>
      <p className="mt-1 text-5xl font-bold tabular-nums">
        {score} <span className="text-2xl font-medium text-faint">/ {total}</span>
      </p>
      {extra && <p className="mt-2 text-muted">{extra}</p>}
      <div className="mt-8 flex justify-center gap-2">
        <button className={SECONDARY} onClick={onExit}>
          {t("backToDeck")}
        </button>
        <button autoFocus className={PRIMARY} onClick={onRestart}>
          {t("restart")}
        </button>
      </div>
    </div>
  );
}

/** Parcourir les cartes en les retournant, sans planification. */
export function FlipMode({ cards, onExit }: ModeProps) {
  const t = useT();
  const [order, setOrder] = useState(cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = order[index];
  const go = (delta: number) => {
    setFlipped(false);
    setIndex((i) => Math.max(0, Math.min(order.length - 1, i + delta)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <Progress index={index} total={order.length} />
      <button
        aria-label={t("flipHint")}
        onClick={() => setFlipped((f) => !f)}
        className={`${CARD} grid min-h-64 w-full place-items-center whitespace-pre-wrap p-10 text-center ${
          flipped ? "text-xl" : "text-2xl font-semibold"
        }`}
      >
        {flipped ? card.back : card.front}
      </button>
      <p className="mt-2 text-center text-xs text-faint">{t("flipHint")}</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <button className={SECONDARY} onClick={onExit}>
          {t("backToDeck")}
        </button>
        <span className="flex gap-2">
          <button
            className={SECONDARY}
            onClick={() => {
              setOrder(shuffle(order));
              setIndex(0);
              setFlipped(false);
            }}
          >
            {t("shuffle")}
          </button>
          <button className={SECONDARY} disabled={index === 0} onClick={() => go(-1)}>
            ←
          </button>
          <button className={PRIMARY} disabled={index === order.length - 1} onClick={() => go(1)}>
            →
          </button>
        </span>
      </div>
    </>
  );
}

function ChoiceList({
  choices,
  answer,
  picked,
  onPick,
}: {
  choices: string[];
  answer: number;
  picked: number | null;
  onPick: (i: number) => void;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {choices.map((choice, i) => {
        const state =
          picked === null
            ? ""
            : i === answer
              ? "bg-[#dbeddb] text-[#1c3829] dark:bg-[#2b593f] dark:text-white"
              : i === picked
                ? "bg-[#ffe2dd] text-[#5d1715] dark:bg-[#6e3630] dark:text-white"
                : "opacity-50";
        return (
          <button
            key={i}
            disabled={picked !== null}
            onClick={() => onPick(i)}
            className={`flex min-h-12 items-center gap-3 whitespace-pre-wrap rounded-lg px-4 py-2.5 text-left shadow-[0_0_0_1px_var(--color-line)] enabled:hover:bg-hover ${state}`}
          >
            <span className="text-xs font-semibold text-faint">{i + 1}</span>
            {choice}
          </button>
        );
      })}
    </div>
  );
}

/** Questions à choix multiples : celles d'un quiz, ou fabriquées à partir d'un paquet de cartes. */
export function ChoiceMode({ questions, onExit }: { questions: Question[]; onExit: () => void }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const q = questions[index];

  const pick = (i: number) => {
    if (picked !== null || !q || i >= q.choices.length) return;
    setPicked(i);
    if (i === q.answer) setScore((s) => s + 1);
  };
  const next = () => {
    setPicked(null);
    setIndex((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) pick(Number(e.key) - 1);
      // Sur un bouton, Entrée déclenche déjà son clic : ne pas avancer une seconde fois.
      else if (e.key === "Enter" && picked !== null && (e.target as HTMLElement).tagName !== "BUTTON") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q)
    return (
      <Result
        score={score}
        total={questions.length}
        onExit={onExit}
        onRestart={() => {
          setIndex(0);
          setScore(0);
        }}
      />
    );
  return (
    <>
      <Progress index={index} total={questions.length} />
      <div className={`${CARD} whitespace-pre-wrap px-8 py-10 text-center text-xl font-semibold`}>{q.question}</div>
      <ChoiceList choices={q.choices} answer={q.answer} picked={picked} onPick={pick} />
      {picked !== null && (
        <div className="mt-4 flex items-start justify-between gap-4">
          <p className="text-muted">{q.explanation}</p>
          <button autoFocus className={`${PRIMARY} shrink-0`} onClick={next}>
            {t("continue")}
          </button>
        </div>
      )}
    </>
  );
}

/** Transforme un paquet en questions à choix multiples. */
export function questionsFromCards(cards: CardRow[]): Question[] {
  return shuffle(cards).map((card) => {
    const choices = choicesFor(card, cards);
    return { question: card.front, choices, answer: choices.indexOf(card.back) };
  });
}

/** Taper la réponse ; en cas d'écart, on peut se déclarer juste. */
export function WriteMode({ cards, onExit }: ModeProps) {
  const t = useT();
  const order = useMemo(() => shuffle(cards), [cards]);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const card = order[index];

  const next = (right: boolean) => {
    if (right) setScore((s) => s + 1);
    setValue("");
    setChecked(null);
    setIndex((i) => i + 1);
  };

  if (!card)
    return (
      <Result
        score={score}
        total={order.length}
        onExit={onExit}
        onRestart={() => {
          setIndex(0);
          setScore(0);
        }}
      />
    );
  return (
    <>
      <Progress index={index} total={order.length} />
      <div className={`${CARD} whitespace-pre-wrap px-8 py-10 text-center text-xl font-semibold`}>{card.front}</div>
      {checked === null ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setChecked(sameAnswer(value, card.back));
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("yourAnswer")}
            aria-label={t("yourAnswer")}
            className="h-9 min-w-0 flex-1 rounded-md bg-hover px-3 placeholder:text-faint"
          />
          <button className={PRIMARY}>{t("check")}</button>
        </form>
      ) : (
        <div className="mt-4">
          <p className={`font-medium ${checked ? "text-[#448361]" : "text-danger"}`}>
            {checked ? t("correct") : `${t("expected")} :`}
          </p>
          {!checked && <p className="mt-1 whitespace-pre-wrap text-lg">{card.back}</p>}
          <div className="mt-4 flex justify-end gap-2">
            {!checked && (
              <button className={SECONDARY} onClick={() => next(true)}>
                {t("iWasRight")}
              </button>
            )}
            <button autoFocus className={PRIMARY} onClick={() => next(checked)}>
              {t("continue")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

type Tile = { key: string; cardId: string; text: string };

/** Jeu d'association chronométré : relier chaque question à sa réponse. */
export function MatchMode({ cards, onExit }: ModeProps) {
  const t = useT();
  const [round, setRound] = useState(0);
  const tiles = useMemo<Tile[]>(() => {
    const picked = shuffle(cards).slice(0, 6);
    return shuffle(
      picked.flatMap((c) => [
        { key: `${c.id}:q`, cardId: c.id, text: c.front },
        { key: `${c.id}:a`, cardId: c.id, text: c.back },
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, round]);
  const [selected, setSelected] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string[]>([]);
  const [start, setStart] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const finished = done.size === tiles.length / 2;

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(timer);
  }, [finished, start]);

  const click = (tile: Tile) => {
    if (wrong.length > 0) return;
    const first = tiles.find((x) => x.key === selected);
    if (!first) return setSelected(tile.key);
    if (first.key === tile.key) return setSelected(null);
    setSelected(null);
    if (first.cardId === tile.cardId) return setDone((d) => new Set(d).add(tile.cardId));
    setWrong([first.key, tile.key]);
    setTimeout(() => setWrong([]), 500);
  };

  const seconds = (elapsed / 1000).toFixed(1);
  if (finished)
    return (
      <Result
        score={tiles.length / 2}
        total={tiles.length / 2}
        extra={`${t("time")} : ${seconds} s`}
        onExit={onExit}
        onRestart={() => {
          setDone(new Set());
          setStart(Date.now());
          setElapsed(0);
          setRound((r) => r + 1);
        }}
      />
    );
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button className={SECONDARY} onClick={onExit}>
          {t("backToDeck")}
        </button>
        <span className="tabular-nums text-muted">{seconds} s</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            disabled={done.has(tile.cardId)}
            onClick={() => click(tile)}
            className={`grid min-h-24 place-items-center whitespace-pre-wrap rounded-lg p-3 text-center text-[13px] shadow-[0_0_0_1px_var(--color-line)] transition-opacity disabled:opacity-0 ${
              wrong.includes(tile.key)
                ? "bg-[#ffe2dd] text-[#5d1715]"
                : selected === tile.key
                  ? "bg-accent/15 shadow-[0_0_0_2px_var(--color-accent)]"
                  : "bg-pop hover:bg-hover"
            }`}
          >
            {tile.text}
          </button>
        ))}
      </div>
    </>
  );
}
