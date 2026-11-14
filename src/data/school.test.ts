import { describe, expect, it } from "vitest";
import { toMinutes } from "./school";

describe("emploi du temps", () => {
  it("convertit une heure en minutes", () => expect(toMinutes("08:30")).toBe(510));
});
