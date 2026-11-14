import { db } from "../db";
import type { Lang } from "../i18n";
import { createPage, restorePage } from "./pages";
import { dayKey, keyNoon } from "./stats";

/**
 * Note du jour : une page par date, rangée dans une page « Journal » créée à la demande.
 * Les identifiants sont déterministes : deux appareils qui ouvrent la note du même jour écrivent la même page.
 */
export const JOURNAL_ID = "journal";
export const dailyId = (key: string) => `journal-${key}`;

/** Titre de la note : la date en toutes lettres, dans la langue de l'interface (« Samedi 14 novembre 2026 »). */
export function dailyTitle(key: string, lang: Lang): string {
  const text = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(keyNoon(key)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Les notes les plus récentes en tête : la position est l'opposé du début du jour. */
export const dailyPosition = (key: string) => -new Date(`${key}T00:00:00`).getTime();

type Row = { id: string; deleted_at: number | null };

/** Crée la page si elle manque, la sort de la corbeille si elle y est. */
async function ensure(id: string, create: () => Promise<unknown>) {
  const row = (await db().all<Row>("SELECT id, deleted_at FROM pages WHERE id = ?", [id]))[0];
  if (!row) {
    // Une synchro peut l'avoir apportée entre-temps : on ne recrée pas une page qui existe déjà.
    await create().catch(async (err) => {
      if (!(await db().all("SELECT 1 FROM pages WHERE id = ?", [id])).length) throw err;
    });
  } else if (row.deleted_at !== null) await restorePage(id);
}

async function ensureDaily(lang: Lang, now: number, journalTitle: string): Promise<string> {
  const key = dayKey(now);
  const id = dailyId(key);
  await ensure(JOURNAL_ID, () => createPage({ id: JOURNAL_ID, title: journalTitle, icon: "📔" }));
  await ensure(id, () =>
    createPage({ id, parentId: JOURNAL_ID, title: dailyTitle(key, lang), position: dailyPosition(key) }),
  );
  return id;
}

let pending: Promise<string> | null = null;

/** Identifiant de la note du jour, créée au besoin (un double clic ne crée qu'une page). */
export function dailyNote(lang: Lang, journalTitle: string, now = Date.now()): Promise<string> {
  pending ??= ensureDaily(lang, now, journalTitle).finally(() => (pending = null));
  return pending;
}
