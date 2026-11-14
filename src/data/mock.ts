import { db } from "../db";
import type { CardRow } from "./cards";
import { answerOf } from "./cloze";
import { listQuizzes } from "./quizzes";
import { sameAnswer, shuffle } from "./study";

/** Examen blanc : questions tirées des quiz et des cartes, corrigées seulement à la fin (fonctions pures). */

export type MockQuestion =
  | {
      kind: "choice";
      key: string;
      prompt: string;
      choices: string[];
      answer: number;
      explanation?: string;
    }
  | { kind: "card"; key: string; card: CardRow; expected: string };

/** Réponse donnée : indice du choix, texte tapé, ou rien. */
export type MockAnswer = number | string | null;

type QuizLike = {
  id: string;
  questions: { question: string; choices: string[]; answer: number; explanation?: string }[];
};

/** Toutes les questions possibles : chaque question de quiz, chaque carte (une par trou). */
export function buildPool(cards: CardRow[], quizzes: QuizLike[]): MockQuestion[] {
  const fromQuizzes: MockQuestion[] = quizzes.flatMap((quiz) =>
    quiz.questions.map((q, i) => ({
      kind: "choice" as const,
      key: `quiz:${quiz.id}:${i}`,
      prompt: q.question,
      choices: q.choices,
      answer: q.answer,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    })),
  );
  const fromCards: MockQuestion[] = cards.map((card) => ({
    kind: "card",
    key: `card:${card.id}`,
    card,
    expected: answerOf(card),
  }));
  return [...fromQuizzes, ...fromCards];
}

/** Tire `n` questions au hasard (toutes s'il y en a moins). */
export const drawQuestions = (pool: MockQuestion[], n: number, random: () => number = Math.random) =>
  shuffle(pool, random).slice(0, Math.max(1, n));

export function isCorrect(q: MockQuestion, a: MockAnswer): boolean {
  if (q.kind === "choice") return a === q.answer;
  return typeof a === "string" && sameAnswer(a, q.expected);
}

/** Bilan : `accepted` liste les réponses tapées que l'étudiant a déclarées justes malgré l'écart. */
export function scoreMock(questions: MockQuestion[], answers: MockAnswer[], accepted: Set<string> = new Set()) {
  const right = questions.map((q, i) => isCorrect(q, answers[i] ?? null) || accepted.has(q.key));
  return {
    score: right.filter(Boolean).length,
    total: questions.length,
    wrong: questions.filter((_, i) => !right[i]),
    right,
  };
}

/** Durée d'une relance des seules erreurs : la même cadence par question, une minute au moins. */
export const retryMinutes = (minutes: number, total: number, wrong: number) =>
  Math.max(1, Math.round((minutes * wrong) / Math.max(1, total)));

/** Questions disponibles pour un ensemble de pages (cartes et quiz rattachés à ces pages). */
export async function loadPool(pageIds: string[]): Promise<MockQuestion[]> {
  if (!pageIds.length) return [];
  const marks = pageIds.map(() => "?").join(",");
  const [cards, quizzes] = await Promise.all([
    db().all<CardRow>(
      `SELECT id, page_id, front, back, fsrs, due FROM cards WHERE page_id IN (${marks})
       AND page_id IN (SELECT id FROM pages WHERE deleted_at IS NULL) ORDER BY created_at, id`,
      pageIds,
    ),
    listQuizzes(),
  ]);
  const wanted = new Set(pageIds);
  return buildPool(cards, quizzes.filter((q) => q.page_id && wanted.has(q.page_id)));
}
