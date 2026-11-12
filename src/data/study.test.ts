import { describe, expect, it } from "vitest";
import { choicesFor, sameAnswer, shuffle } from "./study";

describe("révision", () => {
  it("accepte une réponse aux accents, à la casse ou à la ponctuation près", () => {
    expect(sameAnswer("  Theoreme de pythagore ", "Théorème de Pythagore.")).toBe(true);
    expect(sameAnswer("cos x", "cos(x)")).toBe(true);
    expect(sameAnswer("sin(x)", "cos(x)")).toBe(false);
    expect(sameAnswer("", "")).toBe(false);
  });

  it("propose la bonne réponse et des intrus distincts", () => {
    const deck = [
      { id: "1", back: "Paris" },
      { id: "2", back: "Rome" },
      { id: "3", back: "paris" },
      { id: "4", back: "Madrid" },
      { id: "5", back: "Rome" },
    ];
    const choices = choicesFor(deck[0], deck);
    expect(choices).toContain("Paris");
    expect(choices.sort()).toEqual(["Madrid", "Paris", "Rome"]);
  });

  it("mélange sans perdre d'élément", () => {
    expect(shuffle([1, 2, 3, 4], () => 0).sort()).toEqual([1, 2, 3, 4]);
  });
});
