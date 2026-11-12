import { useEffect, useState } from "react";
import type { Grade } from "ts-fsrs";
import { dueCards, gradeCard, previewIntervals, type CardRow } from "../data/cards";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { View } from "./common";

const GRADES: [Grade, Key, string][] = [
  [1, "again", "text-red-600 dark:text-red-400"],
  [2, "hard", "text-amber-600 dark:text-amber-400"],
  [3, "good", "text-accent"],
  [4, "easy", "text-sky-600 dark:text-sky-400"],
];

function interval(due: Date, now: Date, lang: string): string {
  const min = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60_000));
  const day = lang === "fr" ? "j" : "d";
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  if (min < 43_200) return `${Math.round(min / 1440)} ${day}`;
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

  if (!queue) return null;
  const card = queue[0];

  if (!card)
    return (
      <View title={t("review")}>
        <div className="rounded-xl border border-line p-10 text-center">
          <p className="text-lg font-semibold">{t("reviewDone")}</p>
          <p className="mt-2 text-sm text-muted">{t("reviewDoneSub")}</p>
        </div>
      </View>
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
    <View title={t("review")}>
      <p className="-mt-4 mb-6 text-sm text-muted">
        {queue.length} {t("remaining")}
      </p>
      <div className="rounded-xl border border-line">
        <div className="whitespace-pre-wrap p-8 text-center text-xl font-medium">{card.front}</div>
        {revealed && (
          <div className="whitespace-pre-wrap border-t border-line p-8 text-center text-lg">{card.back}</div>
        )}
      </div>

      {revealed ? (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {GRADES.map(([g, key, color]) => (
            <button key={g} onClick={() => grade(g)} className="rounded-lg border border-line py-2 hover:bg-hover">
              <span className={`block text-sm font-semibold ${color}`}>{t(key)}</span>
              <span className="block text-xs text-muted">{interval(preview[g], now, lang)}</span>
            </button>
          ))}
        </div>
      ) : (
        <button
          autoFocus
          onClick={() => setRevealed(true)}
          className="mt-4 w-full rounded-lg bg-accent py-2.5 font-semibold text-bg"
        >
          {t("showAnswer")}
        </button>
      )}

      {source && (
        <button
          onClick={() => navigate({ view: "page", id: source.id })}
          className="mt-4 text-sm text-muted underline-offset-2 hover:underline"
        >
          {t("openSource")} : {source.title || t("untitled")}
        </button>
      )}
    </View>
  );
}
