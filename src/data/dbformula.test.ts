import { describe, expect, it } from "vitest";
import { evalFormula, formulaIssue, FORMULA_FUNCTION_NAMES } from "./dbformula";
import type { Prop } from "./dbquery";

const props: Prop[] = [
  { id: "n", name: "Note", type: "number" },
  { id: "t", name: "Titre", type: "text" },
  { id: "d", name: "Date", type: "date" },
  { id: "ok", name: "Rendu", type: "checkbox" },
];
const v = { n: 12.5, t: "  Chapitre  ", d: "2026-01-31", ok: true };
const ev = (f: string, values: Record<string, string | number | boolean> = v) => evalFormula(f, values, props);

describe("fonctions numériques", () => {
  it("arrondit, plafonne et calcule", () => {
    expect(ev("floor({Note})")).toBe(12);
    expect(ev("ceil({Note})")).toBe(13);
    expect(ev("abs(-3)")).toBe(3);
    expect(ev("min(4; 2; 9)")).toBe(2);
    expect(ev("max(4, 2, 9)")).toBe(9);
    expect(ev("sum(1, 2, 3)")).toBe(6);
    expect(ev("pow(2, 10)")).toBe(1024);
    expect(ev("sqrt(81)")).toBe(9);
    expect(ev("mod(10, 3)")).toBe(1);
    expect(ev("10 % 4")).toBe(2);
    expect(ev("mod(1, 0)")).toBeNull();
    expect(ev('number("3,5") + 1')).toBe(4.5);
    expect(ev('number("abc")')).toBeNull();
  });
});

describe("fonctions de texte et de logique", () => {
  it("manipule le texte", () => {
    expect(ev("trim({Titre})")).toBe("Chapitre");
    expect(ev('contains({Titre}, "PITRE")')).toBe(1);
    expect(ev('if(contains({Titre}, "xyz"), "oui", "non")')).toBe("non");
    expect(ev('replace("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(ev('slice("abcdef", 1, 3)')).toBe("bc");
    expect(ev("text({Note})")).toBe("12.5");
    expect(ev("lower(upper(trim({Titre})))")).toBe("chapitre");
  });

  it("gère les booléens et empty()", () => {
    expect(ev("and({Rendu}, {Note} > 10)")).toBe(1);
    expect(ev("or(false, {Note} < 10)")).toBe(0);
    expect(ev('if(not({Rendu}), "non", "oui")')).toBe("oui");
    expect(ev("{Note} > 10 && {Rendu}")).toBe(1);
    expect(ev("{Note} > 20 || !{Rendu}")).toBe(0);
    expect(ev('if(empty({Titre}), "vide", "rempli")', { ...v, t: "" })).toBe("vide");
    // empty() accepte une propriété jamais renseignée.
    expect(ev('if(empty({Titre}), "vide", "rempli")', { n: 1 })).toBe("vide");
  });
});

describe("dates", () => {
  it("ajoute, formate et décompose", () => {
    expect(ev('dateAdd({Date}, 1, "days")')).toBe("2026-02-01");
    expect(ev('dateAdd({Date}, 1, "month")')).toBe("2026-02-28");
    expect(ev('dateAdd("2026-01-10", 2, "weeks")')).toBe("2026-01-24");
    expect(ev('dateAdd("2026-01-10", 1, "year")')).toBe("2027-01-10");
    expect(ev('dateAdd("2026-01-10T09:00", 90, "minutes")')).toBe("2026-01-10T10:30");
    expect(ev("dateAdd({Date}, 3)")).toBe("2026-02-03");
    expect(ev('formatDate({Date}, "DD/MM/YYYY")')).toBe("31/01/2026");
    expect(ev("formatDate({Date})")).toBe("31/01/2026");
    expect(ev('formatDate("2026-01-10T09:05", "HH:mm")')).toBe("09:05");
    expect(ev("year({Date}) * 100 + month({Date})")).toBe(202601);
    expect(ev("day({Date})")).toBe(31);
    expect(ev('weekday("2026-01-12")')).toBe(1); // lundi
    expect(ev('days("2026-01-10T08:00", "2026-01-17")')).toBe(7);
    expect(String(ev("today()"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(ev("now()"))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(ev('dateAdd("pas une date", 1)')).toBeNull();
  });

  it("lit le début d'une plage de dates", () => {
    expect(ev("day({Date})", { ...v, d: "2026-03-05/2026-03-09" })).toBe(5);
  });
});

describe("diagnostic", () => {
  it("ne signale rien pour une formule correcte, même si les valeurs manquent", () => {
    expect(formulaIssue("{Note} * 2 + 1", props)).toBeNull();
    expect(formulaIssue("", props)).toBeNull();
    expect(formulaIssue('if({Rendu}, formatDate({Date}), "")', props)).toBeNull();
  });

  it("explique les erreurs", () => {
    expect(formulaIssue("2 +", props)?.code).toBe("syntax");
    expect(formulaIssue("(1 + 2", props)?.code).toBe("unclosed");
    expect(formulaIssue("round(1, 2", props)?.code).toBe("unclosed");
    expect(formulaIssue("foo(1)", props)).toEqual({ code: "unknownFunction", detail: "foo" });
    expect(formulaIssue("{Inconnue} + 1", props)).toEqual({ code: "unknownProp", detail: "Inconnue" });
    expect(formulaIssue("if(1, 2)", props)?.code).toBe("argCount");
    expect(formulaIssue("today(1)", props)?.code).toBe("argCount");
    expect(formulaIssue('"a" * 2', props)?.code).toBe("type");
    expect(formulaIssue("1 / 0", props)?.code).toBe("divZero");
    expect(formulaIssue("1 2", props)?.code).toBe("syntax");
  });

  it("liste les fonctions de l'aide", () => {
    expect(FORMULA_FUNCTION_NAMES).toEqual(
      expect.arrayContaining(["if", "dateAdd", "formatDate", "now", "and", "empty"]),
    );
    expect(new Set(FORMULA_FUNCTION_NAMES.map((n) => n.toLowerCase())).size).toBe(FORMULA_FUNCTION_NAMES.length);
  });
});
