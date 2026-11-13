import { describe, expect, it } from "vitest";
import { applyView, evalFormula, withFormulas, type DbView, type Prop, type Row } from "./dbquery";

const props: Prop[] = [
  {
    id: "st",
    name: "Statut",
    type: "select",
    options: [
      { id: "todo", name: "À faire", color: "gray" },
      { id: "done", name: "Fait", color: "green" },
    ],
  },
  { id: "n", name: "Note", type: "number" },
  { id: "d", name: "Date", type: "date" },
  { id: "ok", name: "Rendu", type: "checkbox" },
];
const row = (id: string, title: string, p: Row["props"], position = 0): Row => ({
  id,
  title,
  icon: null,
  cover: null,
  props: p,
  position,
  created_at: 0,
  updated_at: 0,
});
const rows = [
  row("a", "Algèbre", { st: "done", n: 12, d: "2026-01-10", ok: true }, 1),
  row("b", "Biologie", { st: "todo", n: 15, d: "2026-03-01" }, 2),
  row("c", "Chimie", {}, 3),
];
const view = (patch: Partial<DbView>): DbView => ({
  id: "v",
  name: "",
  type: "table",
  filters: [],
  sort: null,
  ...patch,
});
const ids = (v: Partial<DbView>) =>
  applyView([...rows], view(v), props)
    .map((r) => r.id)
    .join("");

describe("applyView", () => {
  it("garde l'ordre manuel sans tri", () => expect(ids({})).toBe("abc"));

  it("filtre par type de propriété", () => {
    const f = (prop: string, op: any, value = "") => ({ filters: [{ id: "f", prop, op, value }] });
    expect(ids(f("title", "contains", "BI"))).toBe("b");
    expect(ids(f("st", "is", "todo"))).toBe("b");
    expect(ids(f("st", "is_not", "todo"))).toBe("ac");
    expect(ids(f("n", "after", "12"))).toBe("b");
    expect(ids(f("d", "before", "2026-02-01"))).toBe("a");
    expect(ids(f("ok", "unchecked"))).toBe("bc");
    expect(ids(f("n", "empty"))).toBe("c");
    expect(ids(f("n", "is", ""))).toBe("abc");
    expect(ids(f("supprimée", "is", "x"))).toBe("abc");
  });

  it("trie et place les valeurs vides à la fin dans les deux sens", () => {
    expect(ids({ sort: { prop: "n", dir: "desc" } })).toBe("bac");
    expect(ids({ sort: { prop: "n", dir: "asc" } })).toBe("abc");
    expect(ids({ sort: { prop: "st", dir: "asc" } })).toBe("bac");
    expect(ids({ sort: { prop: "title", dir: "desc" } })).toBe("cba");
  });
});

describe("formules", () => {
  it("calcule avec priorités, parenthèses et propriétés", () => {
    expect(evalFormula("{Note} * 2 + 1", { n: 12 }, props)).toBe(25);
    expect(evalFormula("({note} + 3) / 2", { n: 12 }, props)).toBe(7.5);
    expect(evalFormula("-{Note} + 1,5", { n: 2 }, props)).toBe(-0.5);
    expect(evalFormula("{Rendu} * 10", { ok: true }, props)).toBe(10);
  });

  it("renvoie null si une valeur manque ou si la formule est invalide", () => {
    expect(evalFormula("{Note} + 1", {}, props)).toBeNull();
    expect(evalFormula("{Inconnue} + 1", { n: 1 }, props)).toBeNull();
    expect(evalFormula("2 +", {}, props)).toBeNull();
    expect(evalFormula("2 / 0", {}, props)).toBeNull();
    expect(evalFormula("alert(1)", {}, props)).toBeNull();
    expect(evalFormula("", {}, props)).toBeNull();
  });

  it("gère textes, dates, comparaisons et fonctions", () => {
    const all: Prop[] = [...props, { id: "t", name: "Titre", type: "text" }, { id: "fin", name: "Fin", type: "date" }];
    const v = { n: 12.345, d: "2026-01-10", fin: "2026-01-17", t: "Chapitre", ok: false };
    expect(evalFormula('{Titre} + " " + {Note}', v, all)).toBe("Chapitre 12.345");
    expect(evalFormula('concat(upper({Titre}), "-", length({Titre}))', v, all)).toBe("CHAPITRE-8");
    expect(evalFormula("days({Date}, {Fin})", v, all)).toBe(7);
    expect(evalFormula("round({Note}, 1)", v, all)).toBe(12.3);
    expect(evalFormula("round(2,5)", v, all)).toBe(2);
    expect(evalFormula("2,5 * 2", v, all)).toBe(5);
    expect(evalFormula('if({Note} >= 10, "Admis", "Refusé")', v, all)).toBe("Admis");
    expect(evalFormula("if({Rendu}, 1, 0) + max(1; 4)", v, all)).toBe(4);
    expect(evalFormula('"a" * 2', v, all)).toBeNull();
    expect(evalFormula("inconnue(1)", v, all)).toBeNull();
  });

  it("ajoute les valeurs calculées aux lignes, utilisables pour le tri", () => {
    const all: Prop[] = [...props, { id: "f", name: "Double", type: "formula", formula: "{Note} * 2" }];
    const computed = withFormulas(rows, all);
    expect(computed.map((r) => r.props.f)).toEqual([24, 30, null]);
    expect(
      applyView(computed, view({ sort: { prop: "f", dir: "desc" } }), all)
        .map((r) => r.id)
        .join(""),
    ).toBe("bac");
  });
});
