import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketLabel,
  bucketOf,
  dayDiff,
  formatDateValue,
  parseDateValue,
  relativeRange,
  serializeDate,
  spanOfValue,
  validDate,
  weekStart,
  weekStartFor,
  writeSpan,
} from "./dbdate";

describe("dates", () => {
  it("valide les dates réelles, avec heure et plage", () => {
    expect(validDate("2026-02-28")).toBe(true);
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2026-01-10T14:30")).toBe(true);
    expect(validDate("2026-01-10T25:00")).toBe(false);
    expect(parseDateValue("2026-01-10")).toEqual({ start: "2026-01-10", end: null, time: false });
    expect(parseDateValue("2026-01-10T09:00/2026-01-12T10:00")).toEqual({
      start: "2026-01-10T09:00",
      end: "2026-01-12T10:00",
      time: true,
    });
    // Une fin antérieure au début est ignorée.
    expect(parseDateValue("2026-01-10/2026-01-01")?.end).toBeNull();
    expect(parseDateValue("n'importe quoi")).toBeNull();
    expect(parseDateValue(12)).toBeNull();
  });

  it("calcule jours, semaines et périodes", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(dayDiff("2026-01-01", "2026-01-31")).toBe(30);
    expect(weekStart("2026-01-14", 1)).toBe("2026-01-12"); // mercredi → lundi
    expect(weekStart("2026-01-14", 0)).toBe("2026-01-11"); // → dimanche
    expect(weekStartFor("fr")).toBe(1);
    expect(weekStartFor("en")).toBe(0);
    expect(bucketOf("2026-01-14T10:00", "month")).toBe("2026-01");
    expect(bucketOf("2026-01-14", "year")).toBe("2026");
    expect(bucketOf("2026-01-14", "week", 1)).toBe("2026-01-12");
    expect(bucketLabel("2026-01", "month", "fr")).toMatch(/^Janvier 2026/);
  });

  it("donne les plages des dates relatives", () => {
    const today = "2026-01-14"; // mercredi
    expect(relativeRange("today", today)).toEqual([today, today]);
    expect(relativeRange("this_week", today, 1)).toEqual(["2026-01-12", "2026-01-18"]);
    expect(relativeRange("this_week", today, 0)).toEqual(["2026-01-11", "2026-01-17"]);
    expect(relativeRange("this_month", today)).toEqual(["2026-01-01", "2026-01-31"]);
    expect(relativeRange("last_month", today)).toEqual(["2025-12-01", "2025-12-31"]);
    expect(relativeRange("past_7", today)).toEqual(["2026-01-08", today]);
    expect(relativeRange("next_7", today)).toEqual([today, "2026-01-20"]);
    expect(relativeRange("inconnu", today)).toBeNull();
  });

  it("déplace et redimensionne une plage en gardant l'heure", () => {
    expect(spanOfValue("2026-01-10/2026-01-12")).toEqual({ start: "2026-01-10", end: "2026-01-12" });
    expect(spanOfValue("2026-01-10", "2026-01-15")).toEqual({ start: "2026-01-10", end: "2026-01-15" });
    expect(spanOfValue("x")).toBeNull();
    expect(writeSpan("2026-01-10", null, "2026-01-11", "2026-01-13", false)).toEqual({
      date: "2026-01-11/2026-01-13",
    });
    expect(writeSpan("2026-01-10T09:00", null, "2026-01-11", "2026-01-11", false)).toEqual({
      date: "2026-01-11T09:00",
    });
    expect(writeSpan("2026-01-10", null, "2026-01-11", "2026-01-13", true)).toEqual({
      date: "2026-01-11",
      end: "2026-01-13",
    });
    expect(writeSpan("2026-01-10", null, "2026-01-11", "2026-01-11", true)).toEqual({ date: "2026-01-11", end: null });
    expect(serializeDate("2026-01-10", "2026-01-10")).toBe("2026-01-10");
  });

  it("met en forme une date, une heure ou une plage", () => {
    expect(formatDateValue("2026-01-10", "en")).toBe("Jan 10, 2026");
    expect(formatDateValue("2026-01-10/2026-01-12", "en")).toContain("→");
    expect(formatDateValue("pas une date", "en")).toBe("pas une date");
  });
});
