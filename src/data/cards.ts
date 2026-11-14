import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { db } from "../db";
import type { Statement } from "../db/types";
import { hasCloze, scheduledIds, splitClozeId } from "./cloze";
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

/** Une carte à trous est rangée en une ligne par trou (« <carte>#c<n> ») ; les autres en une ligne. */
const expand = <T extends { id: string; front: string }>(card: T) =>
  scheduledIds(card.id, card.front).map((id) => ({ ...card, id }));

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
  const wanted = cards.flatMap((c) => expand({ ...c, id: `${pageId}:${c.id}` }));
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
  db().all<CardRow>("SELECT id, page_id, front, back, fsrs, due FROM cards WHERE page_id = ? ORDER BY created_at, id", [
    pageId,
  ]);

/** Carte ajoutée directement au paquet, sans bloc dans la page. */
export const addCard = (pageId: string, front: string, back: string) => addCards(pageId, [{ front, back }]);

/** Ajoute plusieurs cartes d'un coup au paquet d'une page (tout ou rien). */
export async function addCards(pageId: string, cards: { front: string; back: string }[]) {
  const now = Date.now();
  const state = JSON.stringify(createEmptyCard(new Date(now)));
  let order = 0;
  await db().batch(
    cards.flatMap((c) =>
      expand({ id: `extra:${crypto.randomUUID()}`, front: c.front }).map(({ id }) => ({
        sql: "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?,?,?,?,?,?,?)",
        // L'ordre de la liste est gardé dans le paquet.
        params: [id, pageId, c.front, c.back, state, now, now + order++],
      })),
    ),
  );
}

/** Lignes d'une même carte : la carte elle-même et ses trous (« <carte>#c<n> »). */
const SIBLINGS = "(id = ? OR substr(id, 1, ?) = ?)";
const siblingParams = (base: string) => [base, base.length + 2, `${base}#c`];

/**
 * Modifie une carte ajoutée à la main (les cartes d'un bloc se modifient dans la page). Les trous
 * ajoutés deviennent de nouvelles entrées, les trous retirés disparaissent, les autres gardent leur progression.
 */
export async function updateCard(id: string, front: string, back: string) {
  const { base } = splitClozeId(id);
  const rows = await db().all<{ id: string; page_id: string; created_at: number }>(
    `SELECT id, page_id, created_at FROM cards WHERE ${SIBLINGS} ORDER BY created_at`,
    siblingParams(base),
  );
  if (!rows.length) return;
  const wanted = scheduledIds(base, front);
  const have = new Set(rows.map((r) => r.id));
  const statements: Statement[] = [];
  for (const r of rows)
    if (!wanted.includes(r.id)) statements.push({ sql: "DELETE FROM cards WHERE id = ?", params: [r.id] });
  for (const w of wanted)
    statements.push(
      have.has(w)
        ? { sql: "UPDATE cards SET front = ?, back = ? WHERE id = ?", params: [front, back, w] }
        : insertCard(w, rows[0].page_id, front, back, rows[0].created_at),
    );
  await db().batch(statements);
}

/**
 * Découpe en un trou par ligne les cartes à trous rangées d'un seul tenant (créées par le connecteur
 * MCP, ou avant l'arrivée des trous). Sans effet si tout est déjà découpé.
 */
export async function expandLooseClozes() {
  const rows = await db().all<{ id: string; page_id: string; front: string; back: string; created_at: number }>(
    "SELECT id, page_id, front, back, created_at FROM cards WHERE front LIKE '%{{c%' AND id NOT LIKE '%#c%'",
  );
  const statements = rows
    .filter((r) => hasCloze(r.front))
    .flatMap((r) => [
      { sql: "DELETE FROM cards WHERE id = ?", params: [r.id] },
      ...expand(r).map((c) => insertCard(c.id, r.page_id, r.front, r.back, r.created_at)),
    ]);
  if (statements.length) await db().batch(statements);
  return statements.length;
}

/** Masque les zones d'un texte (trous, formules) où un séparateur ne compte pas. */
function maskSpans(line: string): string {
  return line.replace(/\{\{c\d+::[\s\S]*?\}\}|\$\$[\s\S]*?\$\$|\$[^$\s][^$]*?\$/g, (m) => "\u0001".repeat(m.length));
}

/**
 * Lit une liste de cartes collée d'un tableur ou d'un document : une carte par ligne,
 * question et réponse séparées par une tabulation, « ; », « | », « : » ou un tiret entouré d'espaces.
 * Un séparateur placé dans un trou ou une formule ne compte pas ; une carte à trous peut se passer de réponse.
 */
export function parseCardList(text: string): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const masked = maskSpans(line);
    const sep = ["\t", ";", "|", " — ", " – ", " - ", " : ", ":"].find((s) => masked.includes(s));
    if (!sep) {
      if (hasCloze(line)) out.push({ front: line.trim(), back: "" });
      continue;
    }
    const at = masked.indexOf(sep);
    const front = line.slice(0, at).trim();
    const back = line.slice(at + sep.length).trim();
    if (front && (back || hasCloze(front))) out.push({ front, back });
  }
  return out;
}

export const isExtraCard = (id: string) => id.startsWith("extra:");

/** Supprime une carte et, pour une carte à trous, tous ses trous. */
export const deleteCard = (id: string) => {
  const { base } = splitClozeId(id);
  return db().run(`DELETE FROM cards WHERE ${SIBLINGS}`, siblingParams(base));
};

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

/** Note une carte et l'inscrit au journal des révisions (`duration` : temps de réponse en ms, si connu). */
export async function gradeCard(row: CardRow, grade: Grade, now = new Date(), duration: number | null = null) {
  const before = revive(row.fsrs);
  const { card } = scheduler.next(before, now, grade);
  await db().batch([
    { sql: "UPDATE cards SET fsrs = ?, due = ? WHERE id = ?", params: [JSON.stringify(card), card.due.getTime(), row.id] },
    {
      sql: "INSERT INTO review_log (id, card_id, page_id, grade, state, at, duration) VALUES (?,?,?,?,?,?,?)",
      params: [crypto.randomUUID(), row.id, row.page_id, grade, before.state ?? 0, now.getTime(), duration],
    },
  ]);
}
