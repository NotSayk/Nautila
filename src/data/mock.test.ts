import { describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import type { CardRow } from "./cards";
import { buildPool, drawQuestions, isCorrect, loadPool, retryMinutes, scoreMock } from "./mock";

const card = (id: string, front: string, back: string): CardRow => ({ id, page_id: "p", front, back, fsrs: "{}", due: 0 });
const quiz = {
  id: "q",
  questions: [
    { question: "2 + 2 ?", choices: ["3", "4"], answer: 1, explanation: "Addition" },
    { question: "Capitale ?", choices: ["Paris", "Lyon"], answer: 0 },
  ],
};

describe("examen blanc", () => {
  const pool = buildPool([card("a", "H2O", "Eau"), card("b#c2", "{{c1::Na}} et {{c2::Cl}}", "")], [quiz]);

  it("une question par question de quiz et par carte (trou compris)", () => {
    expect(pool.map((q) => q.key)).toEqual(["quiz:q:0", "quiz:q:1", "card:a", "card:b#c2"]);
    expect(pool[3]).toMatchObject({ kind: "card", expected: "Cl" });
    expect(pool[0]).toMatchObject({ kind: "choice", answer: 1, explanation: "Addition" });
  });

  it("tire N questions distinctes, toutes s'il y en a moins", () => {
    const drawn = drawQuestions(pool, 3, () => 0.3);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((q) => q.key)).size).toBe(3);
    expect(drawQuestions(pool, 50)).toHaveLength(4);
  });

  it("corrige à la fin : choix, réponse tapée (sans accents ni casse), réponses acceptées à la main", () => {
    const answers = [1, null, " eau ", "Chlore"];
    expect(isCorrect(pool[2], " eau ")).toBe(true);
    const result = scoreMock(pool, answers);
    expect(result.score).toBe(2);
    expect(result.wrong.map((q) => q.key)).toEqual(["quiz:q:1", "card:b#c2"]);
    expect(scoreMock(pool, answers, new Set(["card:b#c2"])).score).toBe(3);
  });

  it("relance des erreurs : même cadence, une minute au moins", () => {
    expect(retryMinutes(20, 20, 5)).toBe(5);
    expect(retryMinutes(10, 40, 1)).toBe(1);
  });

  it("ne prend que les cartes et quiz des pages choisies", async () => {
    const db = await migratedDb();
    for (const id of ["p", "autre"])
      await db.run("INSERT INTO pages (id, title, created_at, updated_at) VALUES (?, '', 1, 1)", [id]);
    await db.run("INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES ('c1', 'p', 'Q', 'R', '{}', 0, 1)");
    await db.run("INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES ('c2', 'autre', 'Q', 'R', '{}', 0, 1)");
    await db.run(
      "INSERT INTO quizzes (id, page_id, title, questions, created_at) VALUES ('q1', 'p', 'Quiz', ?, 1), ('q2', NULL, 'Libre', ?, 1)",
      [JSON.stringify(quiz.questions), JSON.stringify(quiz.questions)],
    );
    expect((await loadPool(["p"])).map((q) => q.key)).toEqual(["quiz:q1:0", "quiz:q1:1", "card:c1"]);
    expect(await loadPool([])).toEqual([]);
  });
});
