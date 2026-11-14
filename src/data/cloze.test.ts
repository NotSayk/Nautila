import { beforeEach, describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { addCard, addCards, cardStatements, deckCards, deleteCard, expandLooseClozes, parseCardList, updateCard } from "./cards";
import {
  answerOf,
  clozeAnswer,
  clozeNumbers,
  clozePrompt,
  groupNotes,
  parseCloze,
  promptOf,
  scheduledIds,
  splitClozeId,
  wrapCloze,
} from "./cloze";
import { duplicatePage } from "./pages";

describe("analyse des cartes à trous", () => {
  it("découpe texte, trous et indices", () => {
    expect(parseCloze("La {{c1::Seine}} passe à {{c2::Paris::capitale}}.")).toEqual([
      { kind: "text", text: "La " },
      { kind: "cloze", n: 1, answer: "Seine", hint: "" },
      { kind: "text", text: " passe à " },
      { kind: "cloze", n: 2, answer: "Paris", hint: "capitale" },
      { kind: "text", text: "." },
    ]);
  });

  it("garde les accolades d'une formule dans le trou", () => {
    expect(parseCloze("{{c1::$\\sqrt{\\frac{1}{2}}$}} !")).toEqual([
      { kind: "cloze", n: 1, answer: "$\\sqrt{\\frac{1}{2}}$", hint: "" },
      { kind: "text", text: " !" },
    ]);
  });

  it("laisse en texte un trou vide, mal fermé ou numéroté 0", () => {
    for (const text of ["{{c1::}}", "{{c1::abc", "{{c0::x}}", "{{x::y}}", "{{c1::a}b}}"])
      expect(parseCloze(text)).toEqual([{ kind: "text", text }]);
  });

  it("numéros uniques et triés, identifiants stables", () => {
    expect(clozeNumbers("{{c3::a}} {{c1::b}} {{c3::c}}")).toEqual([1, 3]);
    expect(scheduledIds("extra:x", "{{c3::a}} {{c1::b}}")).toEqual(["extra:x#c1", "extra:x#c3"]);
    expect(scheduledIds("extra:x", "sans trou")).toEqual(["extra:x"]);
    expect(splitClozeId("p:b#c12")).toEqual({ base: "p:b", n: 12 });
    expect(splitClozeId("p:b")).toEqual({ base: "p:b", n: null });
  });

  it("masque le trou demandé et montre les autres", () => {
    const text = "{{c1::H}} et {{c2::O::élément}} donnent {{c1::H2O}}";
    expect(clozePrompt(text, 1)).toBe("[…] et O donnent […]");
    expect(clozePrompt(text, 2)).toBe("H et [élément] donnent H2O");
    expect(clozeAnswer(text, 1)).toBe("H … H2O");
    expect(promptOf({ id: "x#c2", front: text, back: "" })).toBe("H et [élément] donnent H2O");
    expect(answerOf({ id: "x#c2", front: text, back: "" })).toBe("O");
    expect(answerOf({ id: "x", front: "Q", back: "R" })).toBe("R");
  });

  it("le bouton « Trou » entoure la sélection avec le numéro suivant", () => {
    expect(wrapCloze("La Seine", 3, 8)).toEqual({ text: "La {{c1::Seine}}", start: 16, end: 16 });
    expect(wrapCloze("{{c2::a}} b", 10, 11).text).toBe("{{c2::a}} {{c3::b}}");
    // Sans sélection : trou vide, curseur à l'intérieur.
    expect(wrapCloze("ab", 1, 1)).toEqual({ text: "a{{c1::}}b", start: 7, end: 7 });
  });

  it("regroupe les trous d'une même carte", () => {
    const rows = [
      { id: "a#c1", front: "f", back: "" },
      { id: "b", front: "g", back: "h" },
      { id: "a#c2", front: "f", back: "" },
    ];
    expect(groupNotes(rows).map((r) => [r.id, r.gaps])).toEqual([
      ["a#c1", 2],
      ["b", 1],
    ]);
  });

  it("liste collée : un séparateur dans un trou ou une formule ne compte pas", () => {
    expect(parseCardList("{{c1::Paris}} est la capitale\n$a - b$ ; $|x|$\nLa {{c1::mitose}} : division")).toEqual([
      { front: "{{c1::Paris}} est la capitale", back: "" },
      { front: "$a - b$", back: "$|x|$" },
      { front: "La {{c1::mitose}}", back: "division" },
    ]);
  });
});

describe("cartes à trous en base", () => {
  beforeEach(async () => {
    const db = await migratedDb();
    await db.run("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('p', 'Bio', 1, 1)");
  });

  it("une carte à deux trous donne deux entrées planifiées, modifiées ensemble", async () => {
    await addCard("p", "{{c1::ADN}} et {{c2::ARN}}", "");
    let rows = await deckCards("p");
    expect(rows.map((r) => splitClozeId(r.id).n)).toEqual([1, 2]);
    const base = splitClozeId(rows[0].id).base;

    // Progression du premier trou : elle doit survivre à la modification du texte.
    const { db } = await import("../db");
    await db().run("UPDATE cards SET due = 42 WHERE id = ?", [rows[0].id]);
    await updateCard(rows[1].id, "{{c1::ADN}} et {{c3::protéines}}", "note");
    rows = await deckCards("p");
    expect(rows.map((r) => [r.id, r.back])).toEqual([
      [`${base}#c1`, "note"],
      [`${base}#c3`, "note"],
    ]);
    expect(rows[0].due).toBe(42);

    await deleteCard(rows[1].id);
    expect(await deckCards("p")).toEqual([]);
  });

  it("cartes d'un bloc et cartes d'un seul tenant découpées, copie de page cohérente", async () => {
    const { db } = await import("../db");
    await db().batch(await cardStatements("p", [{ id: "b1", front: "{{c1::a}} {{c2::b}}", back: "" }]));
    expect((await deckCards("p")).map((r) => r.id)).toEqual(["p:b1#c1", "p:b1#c2"]);
    // Rien ne change si le bloc est réenregistré tel quel.
    expect(await cardStatements("p", [{ id: "b1", front: "{{c1::a}} {{c2::b}}", back: "" }])).toEqual([]);

    await db().run(
      "INSERT INTO cards (id, page_id, front, back, fsrs, due, created_at) VALUES ('extra:m', 'p', '{{c1::x}} {{c2::y}}', '', '{}', 0, 5)",
    );
    expect(await expandLooseClozes()).toBeGreaterThan(0);
    expect(await expandLooseClozes()).toBe(0);
    expect((await deckCards("p")).map((r) => r.id)).toContain("extra:m#c2");

    await addCards("p", [{ front: "{{c1::u}} {{c2::v}}", back: "" }]);
    const copy = await duplicatePage("p", " (copie)");
    const copied = groupNotes(await deckCards(copy));
    expect(copied.map((n) => n.gaps)).toEqual([2, 2, 2]);
  });
});
