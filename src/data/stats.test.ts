import { describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { addCard, deckCards, gradeCard } from "./cards";
import {
  addDays,
  cardBuckets,
  dayKey,
  forecast,
  formatDuration,
  heatLevel,
  heatmap,
  keyNoon,
  loadStudyStats,
  reviewSummary,
  streaks,
  successRate,
  timeByCourse,
  weekStart,
} from "./stats";

const at = (key: string, hour = 12) => new Date(`${key}T${String(hour).padStart(2, "0")}:00:00`).getTime();

describe("jours et semaines", () => {
  it("jour local, ajout de jours à travers les mois et lundi de la semaine", () => {
    expect(dayKey(at("2026-03-01", 0))).toBe("2026-03-01");
    expect(dayKey(at("2026-03-01", 23))).toBe("2026-03-01");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekStart("2026-11-14")).toBe("2026-11-09"); // samedi → lundi
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // dimanche
  });
});

describe("série de jours", () => {
  it("compte la série en cours et le record", () => {
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-10", "2026-11-11", "2026-11-12"];
    expect(streaks(days, "2026-11-12")).toEqual({ current: 3, best: 4, today: true });
  });

  it("la série d'hier tient encore tant que la journée n'est pas finie", () => {
    expect(streaks(["2026-11-12", "2026-11-13"], "2026-11-14")).toEqual({ current: 2, best: 2, today: false });
    expect(streaks(["2026-11-11", "2026-11-12"], "2026-11-14").current).toBe(0);
    expect(streaks([], "2026-11-14")).toEqual({ current: 0, best: 0, today: false });
  });

  it("traverse un changement d'heure et un changement d'année", () => {
    expect(streaks(["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-26").current).toBe(3);
    expect(streaks(["2025-12-31", "2026-01-01"], "2026-01-01").current).toBe(2);
  });
});

describe("carte de chaleur et prévision", () => {
  it("26 colonnes de lundi à dimanche, la dernière contient aujourd'hui", () => {
    const weeks = heatmap(new Map([["2026-11-12", 5]]), "2026-11-14");
    expect(weeks).toHaveLength(26);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[25][0].key).toBe("2026-11-09");
    expect(weeks[25][3]).toEqual({ key: "2026-11-12", count: 5, future: false });
    expect(weeks[25][6]).toEqual({ key: "2026-11-15", count: 0, future: true });
    expect(weeks[0][0].key).toBe("2026-05-18");
  });

  it("intensité par quarts du maximum", () => {
    expect([0, 1, 25, 26, 50, 100].map((n) => heatLevel(n, 100))).toEqual([0, 1, 1, 2, 2, 4]);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it("le retard compte pour aujourd'hui, au-delà de 14 jours rien", () => {
    const now = at("2026-11-14", 9);
    const days = forecast([at("2026-11-01"), at("2026-11-14", 22), at("2026-11-15"), at("2026-11-27"), at("2026-11-28")], now);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ key: "2026-11-14", count: 2 });
    expect(days[1].count).toBe(1);
    expect(days[13]).toEqual({ key: "2026-11-27", count: 1 });
  });
});

describe("taux et répartition", () => {
  it("réussite : tout sauf « à revoir »", () => {
    expect(successRate([1, 3, 4, 2])).toBe(0.75);
    expect(successRate([])).toBeNull();
  });

  it("répartition selon l'état FSRS", () => {
    expect(cardBuckets([0, 0, 1, 3, 2])).toEqual({ fresh: 2, learning: 2, mature: 1 });
  });

  it("temps d'étude par matière sur 7 jours, aujourd'hui compris", () => {
    const now = at("2026-11-14", 18);
    const rows = [
      { course_id: "maths", started_at: at("2026-11-14", 8), duration: 25 * 60_000 },
      { course_id: "maths", started_at: at("2026-11-08", 1), duration: 25 * 60_000 },
      { course_id: "bio", started_at: at("2026-11-10"), duration: 50 * 60_000 },
      { course_id: "bio", started_at: at("2026-11-07", 23), duration: 25 * 60_000 },
    ];
    expect(timeByCourse(rows, now, 7)).toEqual([
      { course_id: "maths", duration: 50 * 60_000 },
      { course_id: "bio", duration: 50 * 60_000 },
    ]);
    expect(timeByCourse(rows, now, 30)[0]).toEqual({ course_id: "bio", duration: 75 * 60_000 });
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(125 * 60_000)).toBe("2 h 05");
    expect(keyNoon("2026-11-14")).toBe(at("2026-11-14"));
  });
});

describe("journal des révisions", () => {
  it("chaque note est journalisée, avec l'état d'avant et la durée", async () => {
    const db = await migratedDb();
    await db.run("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('p', 'Bio', 1, 1)");
    await addCard("p", "Q", "R");
    const [card] = await deckCards("p");
    const now = new Date();
    await gradeCard(card, 1, now, 4200);
    const [again] = await deckCards("p");
    await gradeCard(again, 3, new Date(now.getTime() + 60_000));
    const logs = await db.all<{ card_id: string; page_id: string; grade: number; state: number; duration: number | null }>(
      "SELECT card_id, page_id, grade, state, duration FROM review_log ORDER BY at",
    );
    expect(logs).toEqual([
      { card_id: card.id, page_id: "p", grade: 1, state: 0, duration: 4200 },
      { card_id: card.id, page_id: "p", grade: 3, state: 1, duration: null },
    ]);
    expect(await reviewSummary()).toMatchObject({ current: 1, today: true, reviewedToday: 2 });
    const stats = await loadStudyStats();
    expect(stats.today).toBe(2);
    expect(stats.success).toBe(0.5);
    expect(stats.decks).toEqual([{ page_id: "p", reviews: 2, success: 0.5 }]);
    expect(stats.buckets.learning).toBe(1);
  });
});
