import { describe, expect, it } from "vitest";
import { inferColumn, parseCsv, parseNotionRefs } from "./csv";

describe("csv", () => {
  it("lit guillemets, virgules et retours à la ligne dans un champ", () => {
    expect(parseCsv('﻿Nom,Note\r\n"Dupont, Jean","il a dit ""oui"""\n"deux\nlignes",3\n\n')).toEqual([
      ["Nom", "Note"],
      ["Dupont, Jean", 'il a dit "oui"'],
      ["deux\nlignes", "3"],
    ]);
  });

  it("déduit le type des colonnes", () => {
    const type = (values: string[]) => inferColumn("c", values, "x").prop.type;
    expect(type(["12", "7,5", ""])).toBe("number");
    expect(type(["Yes", "No"])).toBe("checkbox");
    expect(type(["January 5, 2024", "March 1, 2024 → March 3, 2024"])).toBe("date");
    expect(type(["https://a.fr"])).toBe("url");
    expect(type(["À faire", "Fait", "À faire"])).toBe("select");
    expect(type(["un texte libre", "un autre"])).toBe("text");
    expect(type(["", ""])).toBe("text");
  });

  it("convertit les cellules", () => {
    expect(inferColumn("d", ["January 5, 2024"], "x").convert("January 5, 2024")).toBe("2024-01-05");
    const select = inferColumn("s", ["A", "B", "A"], "x");
    expect(select.convert("B")).toBe(select.prop.options![1].id);
    expect(inferColumn("n", ["1"], "x").convert("")).toBeNull();
  });
});

describe("export Notion", () => {
  it("lit une cellule de relation, titres avec virgules et parenthèses compris", () => {
    expect(parseNotionRefs("Maths (Cours%20ab/Maths%20cd.md), Physique, chimie (Cours%20ab/Physique%20ef.md)")).toEqual(
      [
        { title: "Maths", target: "Cours%20ab/Maths%20cd.md" },
        { title: "Physique, chimie", target: "Cours%20ab/Physique%20ef.md" },
      ],
    );
    expect(parseNotionRefs("Algo (S1) (https://www.notion.so/Algo-S1-0123456789abcdef0123456789abcdef)")).toEqual([
      { title: "Algo (S1)", target: "https://www.notion.so/Algo-S1-0123456789abcdef0123456789abcdef" },
    ]);
    expect(parseNotionRefs("Un texte (avec parenthèses)")).toBeNull();
    expect(parseNotionRefs("simple")).toBeNull();
  });

  it("reconnaît une colonne à choix multiples", () => {
    const { prop, convert } = inferColumn("Tags", ["exam, oral", "oral", "exam, tp", ""], "c");
    expect(prop.type).toBe("multi_select");
    expect(prop.options!.map((o) => o.name)).toEqual(["exam", "oral", "tp"]);
    expect(convert("oral, tp")).toEqual(["c-1", "c-2"]);
  });
});
