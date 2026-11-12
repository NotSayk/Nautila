import { describe, expect, it } from "vitest";
import { average, overall, toMinutes, type Grade } from "./school";

const g = (course_id: string, score: number, out_of = 20, weight = 1): Grade => ({
  id: "",
  title: "",
  created_at: 0,
  course_id,
  score,
  out_of,
  weight,
});

describe("moyennes", () => {
  it("ramène chaque note sur 20 et pondère", () => {
    expect(average([g("a", 5, 10), g("a", 16, 20, 3)])).toBeCloseTo((10 + 48) / 4);
    expect(average([])).toBeNull();
    expect(average([g("a", 5, 0)])).toBeNull();
  });

  it("pondère les matières par leur coefficient", () => {
    const grades = [g("maths", 10), g("maths", 14), g("histoire", 18)];
    expect(overall(grades, { maths: 3, histoire: 1 })).toBeCloseTo((12 * 3 + 18) / 4);
    expect(overall(grades, {})).toBeCloseTo(15);
    expect(overall([], {})).toBeNull();
  });

  it("convertit une heure en minutes", () => expect(toMinutes("08:30")).toBe(510));
});
