import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { db } from "../db";
import type { Statement } from "../db/types";
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

/** Insertion d'une carte neuve (progression à zéro). */
export function insertCard(id: string, pageId: string, front: string, back: string, createdAt: number): Statement {
  const state = createEmptyCard(new Date(createdAt));
  return {
    sql: "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?,?,?,?,?,?,?)",
    params: [id, pageId, front, back, JSON.stringify(state), state.due.getTime(), createdAt],
  };
}

/**
 * Instructions qui alignent les cartes en base sur les blocs flashcard de la page. Une carte
 * inchangée n'est pas réécrite (chaque écriture alourdit le journal de synchronisation).
 */
export async function cardStatements(pageId: string, cards: ExtractedCard[], now = Date.now()): Promise<Statement[]> {
  const existing = new Map(
    (
      await db().all<{ id: string; front: string; back: string }>(
        "SELECT id, front, back FROM cards WHERE page_id = ?",
        [pageId],
      )
    ).map((c) => [c.id, c]),
  );
  const wanted = cards.map((c) => ({ ...c, id: `${pageId}:${c.id}` }));
  const keep = new Set(wanted.map((c) => c.id));
  const statements: Statement[] = [];
  // Seules les cartes issues d'un bloc de la page sont alignées ; celles ajoutées à la main
  // ou par le connecteur IA (identifiant « extra:… ») ne sont jamais retirées ici.
  for (const id of existing.keys())
    if (id.startsWith(`${pageId}:`) && !keep.has(id))
      statements.push({ sql: "DELETE FROM cards WHERE id = ?", params: [id] });

  for (const c of wanted) {
    const old = existing.get(c.id);
    if (old) {
      if (old.front !== c.front || old.back !== c.back)
        statements.push({ sql: "UPDATE cards SET front = ?, back = ? WHERE id = ?", params: [c.front, c.back, c.id] });
    } else {
      statements.push(insertCard(c.id, pageId, c.front, c.back, now));
    }
  }
  return statements;
}

/** Aligne les cartes en base sur les blocs flashcard présents dans la page (une seule transaction). */
export async function syncCards(pageId: string, cards: ExtractedCard[]) {
  const statements = await cardStatements(pageId, cards);
  if (statements.length) await db().batch(statements);
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

/** Ajoute plusieurs cartes d'un coup au paquet d'une page (tout ou rien). */
export async function addCards(pageId: string, cards: { front: string; back: string }[]) {
  const now = Date.now();
  const state = JSON.stringify(createEmptyCard(new Date(now)));
  await db().batch(
    cards.map((c, i) => ({
      sql: "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?,?,?,?,?,?,?)",
      // L'ordre de la liste est gardé dans le paquet.
      params: [`extra:${crypto.randomUUID()}`, pageId, c.front, c.back, state, now, now + i],
    })),
  );
}

/** Modifie une carte ajoutée à la main (les cartes d'un bloc se modifient dans la page). */
export const updateCard = (id: string, front: string, back: string) =>
  db().run("UPDATE cards SET front = ?, back = ? WHERE id = ?", [front, back, id]);

/**
 * Lit une liste de cartes collée d'un tableur ou d'un document : une carte par ligne,
 * question et réponse séparées par une tabulation, « ; », « | », « : » ou un tiret entouré d'espaces.
 */
export function parseCardList(text: string): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const sep = ["\t", ";", "|", " — ", " – ", " - ", " : ", ":"].find((s) => line.includes(s));
    if (!sep) continue;
    const at = line.indexOf(sep);
    const front = line.slice(0, at).trim();
    const back = line.slice(at + sep.length).trim();
    if (front && back) out.push({ front, back });
  }
  return out;
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
