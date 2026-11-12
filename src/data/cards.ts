import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { db } from "../db";
import type { ExtractedCard } from "./extract";

export type CardRow = {
  id: string;
  page_id: string;
  front: string;
  back: string;
  fsrs: string;
  due: number;
};

const scheduler = fsrs();

function revive(json: string): Card {
  const raw = JSON.parse(json);
  return { ...raw, due: new Date(raw.due), last_review: raw.last_review ? new Date(raw.last_review) : undefined };
}

/** Aligne les cartes en base sur les blocs flashcard présents dans la page. */
export async function syncCards(pageId: string, cards: ExtractedCard[]) {
  const existing = await db().all<{ id: string }>("SELECT id FROM cards WHERE page_id = ?", [pageId]);
  cards = cards.map((c) => ({ ...c, id: `${pageId}:${c.id}` }));
  const keep = new Set(cards.map((c) => c.id));
  // Seules les cartes issues d'un bloc de la page sont alignées ; celles ajoutées à la main
  // ou par le connecteur IA (identifiant « extra:… ») ne sont jamais retirées ici.
  for (const { id } of existing)
    if (id.startsWith(`${pageId}:`) && !keep.has(id)) await db().run("DELETE FROM cards WHERE id = ?", [id]);

  const known = new Set(existing.map((e) => e.id));
  const now = Date.now();
  for (const c of cards) {
    if (known.has(c.id)) {
      await db().run("UPDATE cards SET front = ?, back = ? WHERE id = ?", [c.front, c.back, c.id]);
    } else {
      const state = createEmptyCard(new Date(now));
      await db().run("INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?,?,?,?,?,?,?)", [
        c.id,
        pageId,
        c.front,
        c.back,
        JSON.stringify(state),
        state.due.getTime(),
        now,
      ]);
    }
  }
}

const LIVE = "page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL)";

/** Cartes à réviser, de tous les paquets ou d'une seule page. */
export const dueCards = (now = Date.now(), pageId?: string) =>
  db().all<CardRow>(
    `SELECT id, page_id, front, back, fsrs, due FROM cards
     WHERE due <= ? AND ${LIVE} ${pageId ? "AND page_id = ?" : ""} ORDER BY due`,
    pageId ? [now, pageId] : [now],
  );

export type Deck = { page_id: string; total: number; due: number };

export const listDecks = (now = Date.now()) =>
  db().all<Deck>(
    `SELECT page_id, COUNT(*) AS total, SUM(due <= ?) AS due FROM cards WHERE ${LIVE} GROUP BY page_id ORDER BY MAX(created_at) DESC`,
    [now],
  );

export const deckCards = (pageId: string) =>
  db().all<CardRow>("SELECT id, page_id, front, back, fsrs, due FROM cards WHERE page_id = ? ORDER BY created_at", [
    pageId,
  ]);

/** Carte ajoutée directement au paquet, sans bloc dans la page. */
export async function addCard(pageId: string, front: string, back: string) {
  const now = Date.now();
  const state = createEmptyCard(new Date(now));
  await db().run("INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?,?,?,?,?,?,?)", [
    `extra:${crypto.randomUUID()}`,
    pageId,
    front,
    back,
    JSON.stringify(state),
    state.due.getTime(),
    now,
  ]);
}

export const isExtraCard = (id: string) => id.startsWith("extra:");
export const deleteCard = (id: string) => db().run("DELETE FROM cards WHERE id = ?", [id]);

export async function cardStats(now = Date.now()): Promise<{ due: number; total: number }> {
  const [row] = await db().all<{ due: number | null; total: number }>(
    `SELECT SUM(due <= ?) AS due, COUNT(*) AS total FROM cards WHERE ${LIVE}`,
    [now],
  );
  return { due: row.due ?? 0, total: row.total };
}

/** Intervalle annoncé pour chaque note, pour l'afficher sur les boutons. */
export function previewIntervals(row: CardRow, now = new Date()): Record<Grade, Date> {
  const preview = scheduler.repeat(revive(row.fsrs), now);
  return { 1: preview[1].card.due, 2: preview[2].card.due, 3: preview[3].card.due, 4: preview[4].card.due };
}

export async function gradeCard(row: CardRow, grade: Grade, now = new Date()) {
  const { card } = scheduler.next(revive(row.fsrs), now, grade);
  await db().run("UPDATE cards SET fsrs = ?, due = ? WHERE id = ?", [JSON.stringify(card), card.due.getTime(), row.id]);
}
