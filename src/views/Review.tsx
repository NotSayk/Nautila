import { useEffect, useState } from "react";
import type { Grade } from "ts-fsrs";
import { dueCards, gradeCard, previewIntervals, type CardRow } from "../data/cards";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { PageIcon, TopBar } from "./common";

const GRADES: [Grade, Key][] = [
  [1, "again"],
  [2, "hard"],
  [3, "good"],
  [4, "easy"],
];

function interval(due: Date, now: Date, lang: string): string {
  const min = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43_200) return `${Math.round(min / 1440)} ${lang === "fr" ? "j" : "d"}`;
  return `${Math.round(min / 43_200)} ${lang === "fr" ? "mois" : "mo"}`;
}

export function Review() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const [queue, setQueue] = useState<CardRow[] | undefined>();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    dueCards().then(setQueue);
  }, []);

  const card = queue?.[0];
  const bar = (
    <TopBar right={card && <span className="px-2 text-faint">{queue!.length} {t("remaining")}</span>}>
      <span className="px-1.5">{t("review")}</span>
    </TopBar>
  );

  if (!queue) return bar;
  if (!card)
    return (
      <>
        {bar}
        <div className="mx-auto max-w-md px-6 pt-[18vh] text-center">
          <p className="text-xl font-semibold">{t("reviewDone")}</p>
          <p className="mt-2 text-muted">{t("reviewDoneSub")}</p>
        </div>
      </>
    );

  const now = new Date();
  const preview = previewIntervals(card, now);
  const source = pages.find((p) => p.id === card.page_id);

  const grade = async (g: Grade) => {
    await gradeCard(card, g, now);
    setRevealed(false);
    // Quand la file est vide, on avance les cartes dues dans les 10 minutes
    // (étapes d'apprentissage) pour finir la séance sans attendre.
    const next = await dueCards();
    setQueue(next.length ? next : await dueCards(Date.now() + 10 * 60_000));
    void useStore.getState().refreshDue();
  };

  return (
    <>
      {bar}
      <div className="mx-auto max-w-[640px] px-6 pb-24 pt-[8vh]">
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
          <div className="whitespace-pre-wrap px-8 py-14 text-center text-2xl font-semibold leading-snug">{card.front}</div>
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
          <button
            autoFocus
            onClick={() => setRevealed(true)}
            className="mt-5 h-9 w-full rounded-md bg-accent font-medium text-white hover:brightness-95"
          >
            {t("showAnswer")}
          </button>
        )}
      </div>
    </>
  );
}
