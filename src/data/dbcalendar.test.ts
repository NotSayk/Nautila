import { describe, expect, it } from "vitest";
import { eventsOn, layoutWeek, monthGrid, shiftSpan, timelineTicks } from "./dbcalendar";

describe("grille du mois", () => {
  it("commence le lundi ou le dimanche selon la langue", () => {
    // Janvier 2026 commence un jeudi.
    expect(monthGrid("2026-01-15", 1)[0]).toBe("2025-12-29");
    expect(monthGrid("2026-01-15", 0)[0]).toBe("2025-12-28");
    expect(monthGrid("2026-01-15")).toHaveLength(42);
  });
});

describe("semaine du calendrier", () => {
  const week = ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16", "2026-01-17", "2026-01-18"];

  it("place un événement sur plusieurs jours sur une seule ligne", () => {
    const { segments } = layoutWeek([{ id: "a", start: "2026-01-13", end: "2026-01-15" }], week, 3);
    expect(segments).toEqual([{ id: "a", col: 1, span: 3, lane: 0, clippedStart: false, clippedEnd: false }]);
  });

  it("coupe ce qui déborde de la semaine", () => {
    const { segments } = layoutWeek([{ id: "a", start: "2026-01-10", end: "2026-01-20" }], week, 3);
    expect(segments[0]).toMatchObject({ col: 0, span: 7, clippedStart: true, clippedEnd: true });
  });

  it("ignore ce qui est hors de la semaine", () => {
    expect(layoutWeek([{ id: "a", start: "2026-01-01", end: "2026-01-02" }], week, 3).segments).toEqual([]);
  });

  it("empile les événements qui se chevauchent et compte ce qui ne rentre pas", () => {
    const events = ["a", "b", "c", "d"].map((id) => ({ id, start: "2026-01-14", end: "2026-01-14" }));
    const { segments, hidden, total } = layoutWeek(events, week, 3);
    expect(segments.map((s) => s.lane)).toEqual([0, 1, 2]);
    expect(hidden[2]).toBe(1);
    expect(total[2]).toBe(4);
    expect(hidden[1]).toBe(0);
  });

  it("réutilise une ligne libre", () => {
    const events = [
      { id: "a", start: "2026-01-12", end: "2026-01-13" },
      { id: "b", start: "2026-01-14", end: "2026-01-15" },
    ];
    expect(layoutWeek(events, week, 2).segments.map((s) => s.lane)).toEqual([0, 0]);
  });

  it("liste les événements d'un jour", () => {
    const events = [
      { id: "a", start: "2026-01-12", end: "2026-01-14" },
      { id: "b", start: "2026-01-15", end: "2026-01-15" },
    ];
    expect(eventsOn(events, "2026-01-13").map((e) => e.id)).toEqual(["a"]);
  });
});

describe("chronologie", () => {
  it("déplace et redimensionne sans inverser la barre", () => {
    expect(shiftSpan("2026-01-10", "2026-01-12", "move", 3)).toEqual({ start: "2026-01-13", end: "2026-01-15" });
    expect(shiftSpan("2026-01-10", "2026-01-12", "end", -5)).toEqual({ start: "2026-01-10", end: "2026-01-10" });
    expect(shiftSpan("2026-01-10", "2026-01-12", "start", 9)).toEqual({ start: "2026-01-12", end: "2026-01-12" });
    expect(shiftSpan("2026-01-10", "2026-01-12", "end", 2)).toEqual({ start: "2026-01-10", end: "2026-01-14" });
  });

  it("gradue par jour, semaine et mois", () => {
    const day = timelineTicks("2026-01-30", 5, "day", "fr");
    expect(day.bottom.map((t) => t.label)).toEqual(["30", "31", "1", "2", "3"]);
    expect(day.top.map((t) => [t.offset, t.days])).toEqual([
      [0, 2],
      [2, 3],
    ]);

    const week = timelineTicks("2026-01-14", 21, "week", "fr", 1);
    // Le lundi 12 commence avant la plage : sa graduation est rognée.
    expect(week.bottom[0]).toMatchObject({ offset: 0, days: 5, label: "12" });
    expect(week.bottom[1]).toMatchObject({ offset: 5, days: 7, label: "19" });
    expect(week.bottom.reduce((n, t) => n + t.days, 0)).toBe(21);

    const month = timelineTicks("2026-12-20", 30, "month", "fr");
    expect(month.top.map((t) => t.label)).toEqual(["2026", "2027"]);
    expect(month.bottom).toHaveLength(2);
  });
});
