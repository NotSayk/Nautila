import { db } from "../db";

export type Question = { question: string; choices: string[]; answer: number; explanation?: string };
export type Quiz = { id: string; page_id: string | null; title: string; questions: Question[]; created_at: number };

export async function listQuizzes(): Promise<Quiz[]> {
  const rows = await db().all<Omit<Quiz, "questions"> & { questions: string }>(
    "SELECT * FROM quizzes ORDER BY created_at DESC",
  );
  return rows.flatMap((row) => {
    try {
      return [{ ...row, questions: JSON.parse(row.questions) as Question[] }];
    } catch {
      return []; // quiz illisible : ignoré plutôt que de bloquer l'écran
    }
  });
}

export const deleteQuiz = (id: string) => db().run("DELETE FROM quizzes WHERE id = ?", [id]);

/** Crée ou remplace un quiz. */
export const saveQuiz = (quiz: Quiz) =>
  db().run(
    `INSERT INTO quizzes (id, page_id, title, questions, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, title = excluded.title, questions = excluded.questions`,
    [quiz.id, quiz.page_id, quiz.title, JSON.stringify(quiz.questions), quiz.created_at],
  );

/**
 * Questions prêtes à enregistrer : sans les choix vides, avec l'indice de la bonne
 * réponse recalculé ; null si une question est incomplète.
 */
export function cleanQuestions(questions: Question[]): Question[] | null {
  const out: Question[] = [];
  for (const q of questions) {
    const question = q.question.trim();
    const kept = q.choices.map((c, i) => ({ c: c.trim(), i })).filter((x) => x.c);
    const answer = kept.findIndex((x) => x.i === q.answer);
    if (!question || kept.length < 2 || answer < 0) return null;
    const explanation = q.explanation?.trim();
    out.push({ question, choices: kept.map((x) => x.c), answer, ...(explanation ? { explanation } : {}) });
  }
  return out.length ? out : null;
}
