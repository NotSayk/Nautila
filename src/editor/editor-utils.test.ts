import { describe, expect, it } from "vitest";
import { countWords, extract } from "../data/extract";
import { refDetails, shortAuthors, citeLabel } from "../data/refs";
import { hitsPath, pathPoints, simplify, toPath } from "./geometry";
import { fitSize, needsShrink } from "./image";
import { matchInlineMath } from "./mathInput";
import { lastTextBlock, parseHighlights, parseStrokes } from "./parse";

describe("lecture sûre des propriétés JSON", () => {
  it("renvoie une liste vide pour une valeur corrompue", () => {
    expect(parseHighlights("{pas du json")).toEqual([]);
    expect(parseHighlights("null")).toEqual([]);
    expect(parseHighlights('{"a":1}')).toEqual([]);
    expect(parseStrokes(undefined)).toEqual([]);
    expect(parseStrokes("42")).toEqual([]);
  });

  it("garde les surlignages anciens (sans couleur) et écarte les entrées invalides", () => {
    const list = parseHighlights(
      JSON.stringify([
        { id: "a", page: 2, text: "x", rects: [{ x: 0, y: 0, w: 1, h: 1 }] },
        { id: "b", page: 1, text: "y", rects: [{ x: 0, y: 0, w: 1, h: 1 }], color: "green" },
        { id: "c", page: 1, text: "z", rects: [], color: "rouge" },
        { id: 3, page: 1, rects: [] },
        null,
        { id: "d", page: 1, rects: [{ x: "1" }, { x: 0, y: 0, w: 1, h: 1 }] },
      ]),
    );
    expect(list.map((h) => [h.id, h.color])).toEqual([
      ["a", undefined],
      ["b", "green"],
      ["c", undefined],
      ["d", undefined],
    ]);
    expect(list[3].rects).toHaveLength(1);
  });

  it("garde les croquis anciens (sans épaisseur) et rejette les chemins suspects", () => {
    const list = parseStrokes(
      JSON.stringify([
        { d: "M1 2 L3 4", color: "#fff" },
        { d: "M1 2 L3 4", color: "red", w: 5 },
        { d: "M1 2 L3 4", color: "red", w: -1 },
        { d: "<script>", color: "red" },
        { color: "red" },
      ]),
    );
    expect(list).toEqual([
      { d: "M1 2 L3 4", color: "#fff" },
      { d: "M1 2 L3 4", color: "red", w: 5 },
      { d: "M1 2 L3 4", color: "red" },
    ]);
  });
});

type B = { type: string; content?: unknown; children?: B[] };

describe("lastTextBlock", () => {
  it("renvoie le dernier bloc textuel, même s'il est imbriqué", () => {
    const inner = { type: "paragraph", content: [{ type: "text", text: "fin" }] };
    expect(lastTextBlock<B>([{ type: "paragraph", content: [], children: [inner] }])).toBe(inner);
    const last = { type: "heading", content: [] };
    expect(lastTextBlock<B>([{ type: "image" }, last])).toBe(last);
  });

  it("renvoie null si la page se termine par un bloc non textuel", () => {
    expect(lastTextBlock<B>([{ type: "paragraph", content: [] }, { type: "image" }])).toBeNull();
    expect(lastTextBlock<B>([{ type: "codeBlock", content: [{ type: "text", text: "x" }] }])).toBeNull();
    expect(lastTextBlock<B>([{ type: "table", content: { type: "tableContent" } }])).toBeNull();
    expect(lastTextBlock<B>([])).toBeNull();
  });
});

describe("saisie des formules en ligne", () => {
  it("reconnaît $x^2 quand le $ fermant vient d'être tapé", () => {
    expect(matchInlineMath("Soit $x^2")).toEqual({ offset: 5, latex: "x^2" });
    expect(matchInlineMath("$a")).toEqual({ offset: 0, latex: "a" });
    expect(matchInlineMath("($\\frac{a}{b}")).toEqual({ offset: 1, latex: "\\frac{a}{b}" });
    expect(matchInlineMath("avec $a + b")).toEqual({ offset: 5, latex: "a + b" });
  });

  it("ne transforme pas les prix ni les $ mal placés", () => {
    expect(matchInlineMath("j'ai 5$ et 10")).toBeNull();
    expect(matchInlineMath("5$ et 10")).toBeNull();
    expect(matchInlineMath("$ x")).toBeNull();
    expect(matchInlineMath("$x ")).toBeNull();
    expect(matchInlineMath("coûte $")).toBeNull();
    expect(matchInlineMath("a\\$x")).toBeNull();
    expect(matchInlineMath("mot$x")).toBeNull();
    expect(matchInlineMath("$$x")).toBeNull();
  });
});

describe("géométrie des croquis", () => {
  it("lit et réécrit un chemin", () => {
    const pts = pathPoints("M1.5 2 L3 4.25 L-1 0");
    expect(pts).toEqual([
      { x: 1.5, y: 2 },
      { x: 3, y: 4.25 },
      { x: -1, y: 0 },
    ]);
    expect(toPath(pts)).toBe("M1.5 2.0 L3.0 4.3 L-1.0 0.0");
  });

  it("simplifie une droite en deux points et garde les angles", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 }));
    expect(simplify(line)).toEqual([line[0], line[49]]);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(simplify(corner)).toEqual([corner[0], corner[2], corner[4]]);
  });

  it("détecte un trait touché par la gomme", () => {
    expect(hitsPath("M0 0 L10 0", { x: 5, y: 3 }, 4)).toBe(true);
    expect(hitsPath("M0 0 L10 0", { x: 5, y: 9 }, 4)).toBe(false);
    expect(hitsPath("M0 0 L10 0", { x: 15, y: 0 }, 4)).toBe(false);
    expect(hitsPath("M5 5", { x: 6, y: 5 }, 2)).toBe(true);
  });
});

describe("réduction des images", () => {
  it("calcule la taille sans jamais agrandir", () => {
    expect(fitSize(4800, 2400)).toEqual({ width: 2400, height: 1200 });
    expect(fitSize(1000, 3000)).toEqual({ width: 800, height: 2400 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("ne touche ni aux GIF et SVG ni aux petites images", () => {
    expect(needsShrink("image/gif", 10_000_000, 5000, 5000)).toBe(false);
    expect(needsShrink("image/svg+xml", 10_000_000, 5000, 5000)).toBe(false);
    expect(needsShrink("image/png", 100_000, 800, 600)).toBe(false);
    expect(needsShrink("image/jpeg", 2_000_000, 1000, 800)).toBe(true);
    expect(needsShrink("image/png", 500_000, 3000, 1000)).toBe(true);
  });
});

describe("références", () => {
  it("relit revue, volume, numéro et pages du BibTeX", () => {
    const bibtex = "@article{k, title={T}, journal={Nature}, volume={12}, number = 3, pages={45--67}}";
    expect(refDetails({ bibtex })).toEqual({ venue: "Nature", volume: "12", number: "3", pages: "45–67" });
    expect(refDetails({ bibtex: "" })).toEqual({ venue: "", volume: "", number: "", pages: "" });
  });

  it("emploie le mot de liaison demandé", () => {
    expect(shortAuthors("Marie Curie and Pierre Curie", "and")).toBe("Curie and Curie");
    expect(citeLabel({ key: "k", title: "", author: "A Dupont and B Martin", year: "2020", bibtex: "" }, "and")).toBe(
      "Dupont and Martin, 2020",
    );
  });
});

describe("texte indexé et nombre de mots", () => {
  const blocks = [
    {
      id: "a",
      type: "paragraph",
      content: [
        { type: "text", text: "deux mots" },
        { type: "math", props: { latex: "\\frac{a}{b}" } },
      ],
    },
    { id: "b", type: "mathBlock", props: { latex: "\\int_0^1 x^2 dx" } },
    { id: "c", type: "image", props: { url: "nautila-file:1", name: "schema.png", caption: "Vue de face" } },
  ];

  it("n'inclut pas le LaTeX dans le nombre de mots", () => {
    expect(countWords(blocks)).toBe(2 + 3);
  });

  it("indexe le LaTeX, la légende et le nom des images pour la recherche", () => {
    const { body } = extract(blocks);
    expect(body).toContain("\\int_0^1 x^2 dx");
    expect(body).toContain("Vue de face");
    expect(body).toContain("schema.png");
  });
});
