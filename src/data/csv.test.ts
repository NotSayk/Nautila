import { describe, expect, it } from "vitest";
import { inferColumn, parseCsv } from "./csv";

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
