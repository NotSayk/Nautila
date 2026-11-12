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
