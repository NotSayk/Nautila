import { describe, expect, it } from "vitest";
import type { DbConfig, DbView, Filter, Prop } from "./dbquery";
import {
  addFilter,
  convertibleTypes,
  countFilters,
  dropFilter,
  duplicateProp,
  duplicateView,
  linkHref,
  mapFilter,
  moveItem,
  moveProp,
  newFilter,
  nudgeProp,
  presetFromFilters,
  toggleCollapsed,
} from "./dbview";

const props: Prop[] = [
  { id: "a", name: "A", type: "text" },
  { id: "b", name: "B", type: "number" },
  { id: "c", name: "C", type: "date" },
];
const view: DbView = { id: "v", name: "Vue", type: "table", filters: [], sort: null };

describe("ordre des propriétés", () => {
  it("déplace un identifiant avant un autre ou à la fin", () => {
    expect(moveItem(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], "b", "zzz")).toEqual(["a", "c", "b"]);
  });

  it("écrit l'ordre complet, propriétés absentes de l'ordre comprises", () => {
    expect(moveProp({ order: ["b"] }, props, "c", "b")).toEqual(["c", "b", "a"]);
    expect(moveProp({}, props, "a", null)).toEqual(["b", "c", "a"]);
  });

  it("décale d'un cran sans sortir de la liste", () => {
    expect(nudgeProp({}, props, "b", -1)).toEqual(["b", "a", "c"]);
    expect(nudgeProp({}, props, "c", 1)).toEqual(["a", "b", "c"]);
    expect(nudgeProp({}, props, "a", -1)).toEqual(["a", "b", "c"]);
  });
});

describe("copies", () => {
  it("duplique une vue avec de nouveaux identifiants de filtres, sans lier les objets", () => {
    let n = 0;
    const source: DbView = {
      ...view,
      filters: [
        { id: "f1", prop: "", op: "is", value: "", mode: "or", group: [{ id: "f2", prop: "a", op: "is", value: "x" }] },
      ],
      widths: { a: 100 },
    };
    const copy = duplicateView(source, "v2", "Copie", () => `n${++n}`);
    expect(copy.id).toBe("v2");
    expect(copy.name).toBe("Copie");
    expect(copy.filters[0].id).toBe("n1");
    expect(copy.filters[0].group?.[0].id).toBe("n2");
    copy.widths!.a = 5;
    expect(source.widths!.a).toBe(100);
  });

  it("duplique une propriété juste après l'originale, sans le lien miroir", () => {
    const config: DbConfig = {
      props: [{ id: "r", name: "R", type: "relation", target: "db", twin: "t" }, props[0]],
      views: [{ ...view, order: ["a", "r"] }],
    };
    const next = duplicateProp(config, "r", "r2", "R (copie)");
    expect(next.props.map((p) => p.id)).toEqual(["r", "r2", "a"]);
    expect(next.props[1].twin).toBeUndefined();
    expect(next.props[1].target).toBe("db");
    expect(next.views[0].order).toEqual(["a", "r", "r2"]);
    expect(duplicateProp(config, "inconnue", "x", "x")).toBe(config);
  });
});

describe("arbre de filtres", () => {
  const group: Filter = {
    id: "g",
    prop: "",
    op: "is",
    value: "",
    mode: "or",
    group: [{ id: "g1", prop: "a", op: "is", value: "x" }],
  };
  const tree: Filter[] = [{ id: "f", prop: "a", op: "is", value: "" }, group];

  it("crée un filtre avec l'opérateur par défaut du type", () => {
    expect(newFilter("n", "b", props).op).toBe("eq");
    expect(newFilter("n", "c", props).op).toBe("is");
    expect(newFilter("n", "title", props).op).toBe("contains");
  });

  it("modifie, ajoute et supprime à tous les niveaux", () => {
    expect(mapFilter(tree, "g1", (f) => ({ ...f, value: "y" }))[1].group?.[0].value).toBe("y");
    expect(addFilter(tree, { id: "n", prop: "b", op: "eq", value: "" }, "g")[1].group).toHaveLength(2);
    expect(addFilter(tree, { id: "n", prop: "b", op: "eq", value: "" })).toHaveLength(3);
    expect(dropFilter(tree, "g1")).toHaveLength(1);
    expect(dropFilter(tree, "f")).toHaveLength(1);
    expect(countFilters(tree)).toBe(2);
  });
});

describe("valeurs d'une ligne créée sous des filtres", () => {
  const fields: Prop[] = [
    { id: "s", name: "S", type: "select", options: [{ id: "o1", name: "Un", color: "gray" }] },
    { id: "m", name: "M", type: "multi_select", options: [{ id: "o1", name: "Un", color: "gray" }] },
    { id: "k", name: "K", type: "checkbox" },
    { id: "n", name: "N", type: "number" },
    { id: "d", name: "D", type: "date" },
    { id: "t", name: "T", type: "text" },
  ];
  const f = (prop: string, op: Filter["op"], value = ""): Filter => ({ id: prop, prop, op, value });

  it("donne leur valeur aux propriétés filtrées en ET", () => {
    const filters = [
      f("s", "is", "o1"),
      f("m", "contains", "o1"),
      f("k", "checked"),
      f("n", "eq", "2,5"),
      f("d", "is", "2026-01-02"),
      f("t", "is", "x"),
    ];
    expect(presetFromFilters(filters, "and", fields)).toEqual({
      s: "o1",
      m: ["o1"],
      k: true,
      n: 2.5,
      d: "2026-01-02",
      t: "x",
    });
  });

  it("ignore le OU, les valeurs inconnues et les filtres incomplets", () => {
    expect(presetFromFilters([f("s", "is", "o1")], "or", fields)).toEqual({});
    expect(presetFromFilters([f("s", "is", "zzz"), f("n", "eq", "abc"), f("t", "is", ""), f("d", "is", "2026-02-31")], undefined, fields)).toEqual({});
    expect(presetFromFilters([f("s", "is_not", "o1"), f("inconnue", "is", "x")], undefined, fields)).toEqual({});
  });
});

describe("divers", () => {
  it("replie et déplie un groupe", () => {
    expect(toggleCollapsed(undefined, "x")).toEqual(["x"]);
    expect(toggleCollapsed(["x", "y"], "x")).toEqual(["y"]);
  });

  it("propose tous les types simples pour une colonne vide", () => {
    expect(convertibleTypes("text", false)).toContain("select");
    expect(convertibleTypes("text", false)).not.toContain("text");
    expect(convertibleTypes("date", true)).toEqual(["text"]);
  });

  it("ne produit que des liens sûrs", () => {
    expect(linkHref("url", "https://a.fr/x")).toBe("https://a.fr/x");
    expect(linkHref("url", "exemple.fr/page")).toBe("https://exemple.fr/page");
    expect(linkHref("url", "javascript:alert(1)")).toBeNull();
    expect(linkHref("url", "pas un lien")).toBeNull();
    expect(linkHref("email", "a@b.fr")).toBe("mailto:a@b.fr");
    expect(linkHref("email", "a@b")).toBeNull();
    expect(linkHref("phone", "+33 1 23 45 67 89")).toBe("tel:+33123456789");
    expect(linkHref("phone", "abc")).toBeNull();
    expect(linkHref("text", "https://a.fr")).toBeNull();
    expect(linkHref("url", null)).toBeNull();
  });
});
