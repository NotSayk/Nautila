import { describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { examPlan, examSessionCards, HEAVY_CARDS, loadExamPlan, orderSession, subtreeIds, upcomingExams } from "./plan";
import type { Task } from "./tasks";

const at = (key: string, hour = 12) => new Date(`${key}T${String(hour).padStart(2, "0")}:00:00`).getTime();
const card = (state: number, due: number) => ({ fsrs: JSON.stringify({ state }), due });

describe("plan de révision d'un examen", () => {
  const now = at("2026-11-14", 9);
  const exam = at("2026-11-19");

  it("compte les nouvelles cartes et celles dues avant l'examen, réparties sur les jours restants", () => {
    const cards = [card(0, 0), card(0, 0), card(2, at("2026-11-15")), card(2, at("2026-11-18", 23)), card(2, at("2026-11-25"))];
    const plan = examPlan(cards, exam, now, 12);
    expect(plan).toMatchObject({ until: 5, days: 5, fresh: 2, due: 2, total: 4, perDay: 1, heavy: false });
    expect(plan.minutes).toBe(1);
  });

  it("le jour même ou la veille : au moins un jour, et rien de passé ne compte comme futur", () => {
    expect(examPlan([card(0, 0)], at("2026-11-14", 18), now)).toMatchObject({ until: 0, days: 1, perDay: 1 });
    expect(examPlan([], at("2026-11-10"), now).until).toBe(-4);
  });

  it("signale une charge irréaliste", () => {
    const many = Array.from({ length: HEAVY_CARDS * 2 + 1 }, () => card(0, 0));
    expect(examPlan(many, at("2026-11-16"), now)).toMatchObject({ days: 2, perDay: HEAVY_CARDS + 1, heavy: true });
    // Beaucoup de temps par carte : lourd même avec peu de cartes.
    expect(examPlan(Array.from({ length: 100 }, () => card(0, 0)), at("2026-11-15"), now, 90).heavy).toBe(true);
  });

  it("séance : cartes dues d'abord (plus en retard en tête), puis nouvelles ; rien de pas encore dû", () => {
    const list = [
      { id: "n1", ...card(0, 1) },
      { id: "late", ...card(2, at("2026-11-01")) },
      { id: "future", ...card(2, at("2026-11-20")) },
      { id: "due", ...card(1, at("2026-11-14", 8)) },
      { id: "n2", ...card(0, 2) },
    ];
    expect(orderSession(list, now).map((c) => c.id)).toEqual(["late", "due", "n1", "n2"]);
  });

  it("matière et sous-pages, sans boucle", () => {
    const pages = [
      { id: "s", parent_id: null },
      { id: "m", parent_id: "s" },
      { id: "c1", parent_id: "m" },
      { id: "c2", parent_id: "c1" },
      { id: "x", parent_id: "s" },
    ];
    expect(subtreeIds(pages, "m")).toEqual(["m", "c1", "c2"]);
    expect(subtreeIds([{ id: "a", parent_id: "b" }, { id: "b", parent_id: "a" }], "a")).toEqual(["a", "b"]);
  });

  it("examens à venir : non faits, datés, aujourd'hui compris, du plus proche au plus lointain", () => {
    const base = { kind: "exam", course_id: null, done: 0, created_at: 0, recurrence: null } as const;
    const tasks = [
      { ...base, id: "loin", title: "", due_at: at("2026-12-01") },
      { ...base, id: "passé", title: "", due_at: at("2026-11-13") },
      { ...base, id: "ajd", title: "", due_at: at("2026-11-14", 20) },
      { ...base, id: "fait", title: "", due_at: at("2026-11-20"), done: 1 },
      { ...base, id: "devoir", title: "", due_at: at("2026-11-15"), kind: "homework" as const },
    ] as Task[];
    expect(upcomingExams(tasks, now).map((x) => x.id)).toEqual(["ajd", "loin"]);
  });
});

describe("plan en base", () => {
  it("calcule le plan d'une matière et ne prend que ses cartes", async () => {
    const db = await migratedDb();
    for (const [id, parent] of [
      ["m", null],
      ["c", "m"],
      ["autre", null],
    ])
      await db.run("INSERT INTO pages (id, parent_id, title, created_at, updated_at) VALUES (?, ?, '', 1, 1)", [id, parent]);
    const insert = (id: string, page: string, state: number, due: number) =>
      db.run("INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES (?, ?, 'q', 'r', ?, ?, 1)", [
        id,
        page,
        JSON.stringify({ state }),
        due,
      ]);
    const now = Date.now();
    await insert("a", "m", 0, now);
    await insert("b", "c", 2, now - 1000);
    await insert("z", "autre", 0, now);
    const task = { id: "e", title: "Partiel", kind: "exam", course_id: "m", due_at: now + 3 * 86_400_000, done: 0, created_at: 0 } as Task;
    const pages = await db.all<{ id: string; parent_id: string | null }>("SELECT id, parent_id FROM pages");
    const detail = await loadExamPlan(task, pages, now);
    expect(detail?.plan).toMatchObject({ fresh: 1, due: 1, total: 2 });
    expect(detail?.pageIds.sort()).toEqual(["c", "m"]);
    expect((await examSessionCards(detail!.pageIds, now)).map((c) => c.id)).toEqual(["b", "a"]);
    expect(await loadExamPlan({ ...task, course_id: null }, pages, now)).toBeNull();
  });
});
