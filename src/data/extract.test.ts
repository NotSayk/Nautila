import { describe, expect, it } from "vitest";
import { extract, toFtsQuery } from "./extract";

describe("extract", () => {
  it("collecte le texte, les cartes complètes et les liens de page", () => {
    const result = extract([
      { id: "a", type: "heading", content: [{ type: "text", text: "Dérivées" }] },
      {
        id: "b",
        type: "paragraph",
        content: [
          { type: "text", text: "Voir " },
          { type: "pageLink", props: { pageId: "p1" } },
          { type: "link", content: [{ type: "text", text: "wiki" }] },
          { type: "math", props: { latex: "x^2" } },
        ],
        children: [{ id: "c", type: "flashcard", props: { front: " Q ", back: "R" } }],
      },
      { id: "d", type: "flashcard", props: { front: "incomplète", back: "" } },
      { id: "e", type: "mathBlock", props: { latex: "\\pi" } },
      {
        id: "f",
        type: "table",
        content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "u" }], { type: "tableCell", content: [{ type: "text", text: "v" }] }] }] },
      },
    ]);
    expect(result.cards).toEqual([{ id: "c", front: "Q", back: "R" }]);
    expect(result.links).toEqual(["p1"]);
    expect(result.body).toBe("Dérivées\nVoir wikix^2\nQ\nR\nincomplète\n\\pi\nu v");
  });
});

describe("toFtsQuery", () => {
  it("neutralise la syntaxe FTS et cherche par préfixe", () => {
    expect(toFtsQuery('théorème "de" Rolle* OR')).toBe('"théorème"* "de"* "Rolle"* "OR"*');
    expect(toFtsQuery("  -- ")).toBe("");
  });
});
