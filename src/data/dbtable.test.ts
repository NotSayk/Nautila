import { describe, expect, it } from "vitest";
import { calcFnsFor, computeCalc, formatNumber, rollupTargets, withComputed, withRollups, type RelatedBase } from "./dbcalc";
import { convertColumn, convertTargets } from "./dbconvert";
import { groupRows, valueForGroup } from "./dbgroup";
import {
  applyView,
  orderedProps,
  positionBefore,
  removeProp,
  searchRows,
  storedValues,
  viewSorts,
  visibleProps,
  withFormulas,
  withSorts,
  type DbView,
  type Filter,
  type Prop,
  type Row,
} from "./dbquery";

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
  {
    id: "tags",
    name: "Étiquettes",
    type: "multi_select",
    options: [
      { id: "a", name: "Cours", color: "blue" },
      { id: "b", name: "TP", color: "red" },
    ],
  },
  { id: "n", name: "Note", type: "number" },
  { id: "d", name: "Date", type: "date" },
  { id: "ok", name: "Rendu", type: "checkbox" },
  { id: "txt", name: "Remarque", type: "text" },
  { id: "rel", name: "Liés", type: "relation", target: "other" },
  { id: "cr", name: "Créé", type: "created_time" },
];
const day = (iso: string) => new Date(`${iso}T10:00:00`).getTime();
const row = (id: string, title: string, p: Row["props"], position = 0, created = 0): Row => ({
  id,
  title,
  icon: null,
  cover: null,
  props: p,
  position,
  created_at: created,
  updated_at: created,
});
const rows = [
  row("a", "Algèbre", { st: "done", n: 12, d: "2026-01-10", ok: true, tags: ["a", "b"], txt: "Beau travail", rel: ["x"] }, 1, day("2026-01-02")),
  row("b", "Biologie", { st: "todo", n: 15, d: "2026-01-12/2026-01-16", tags: ["a"], txt: "à revoir" }, 2, day("2026-02-02")),
  row("c", "Chimie", { n: 12 }, 3, day("2026-02-20")),
  row("d", "Droit", { st: "todo", n: 7, d: "2026-03-01T14:30" }, 4, day("2026-03-05")),
];
const view = (patch: Partial<DbView>): DbView => ({ id: "v", name: "", type: "table", filters: [], sort: null, ...patch });
const f = (prop: string, op: Filter["op"], value = "", extra: Partial<Filter> = {}): Filter => ({
  id: Math.random().toString(36),
  prop,
  op,
  value,
  ...extra,
});
const run = (v: Partial<DbView>, ctx = { now: new Date("2026-01-14T09:00:00"), weekStart: 1 as const }) =>
  applyView([...rows], view(v), props, ctx)
    .map((r) => r.id)
    .join("");

describe("tris multiples", () => {
  it("trie par plusieurs critères dans l'ordre, le suivant départageant les égalités", () => {
    // Note décroissante (15, 12, 12, 7), puis titre décroissant parmi les 12.
    expect(
      run({ sorts: [{ prop: "n", dir: "desc" }, { prop: "title", dir: "desc" }], sort: { prop: "n", dir: "desc" } }),
    ).toBe("bcad");
  });

  it("tri croissant sur la note puis décroissant sur le titre", () => {
    const sorts = [
      { prop: "n", dir: "asc" as const },
      { prop: "title", dir: "desc" as const },
    ];
    expect(run({ sort: sorts[0], sorts })).toBe("dcab");
  });

  it("place toujours les valeurs vides à la fin, et ordonne par date de création", () => {
    expect(run({ sort: { prop: "d", dir: "desc" }, sorts: undefined })).toBe("dbac");
    expect(run({ sort: { prop: "cr", dir: "desc" } })).toBe("dcba");
  });

  it("relit l'ancien tri unique et garde les deux champs cohérents", () => {
    expect(viewSorts(view({ sort: { prop: "n", dir: "asc" } }))).toEqual([{ prop: "n", dir: "asc" }]);
    // Une ancienne version a modifié `sort` : la liste complète est périmée.
    const stale = view({
      sort: { prop: "title", dir: "asc" },
      sorts: [{ prop: "n", dir: "asc" }, { prop: "title", dir: "asc" }],
    });
    expect(viewSorts(stale)).toEqual([{ prop: "title", dir: "asc" }]);
    const next = withSorts(view({}), [{ prop: "n", dir: "asc" }, { prop: "title", dir: "asc" }]);
    expect(next.sort).toEqual({ prop: "n", dir: "asc" });
    expect(viewSorts(next)).toHaveLength(2);
    expect(withSorts(next, []).sorts).toBeUndefined();
    expect(withSorts(next, []).sort).toBeNull();
  });

  it("ignore un tri sur une propriété supprimée", () => {
    expect(run({ sort: { prop: "supprimée", dir: "asc" } })).toBe("abcd");
  });
});

describe("filtres de texte et de nombres", () => {
  it("couvre les opérateurs de texte", () => {
    expect(run({ filters: [f("txt", "contains", "TRAVAIL")] })).toBe("a");
    expect(run({ filters: [f("txt", "not_contains", "travail")] })).toBe("bcd");
    expect(run({ filters: [f("txt", "starts_with", "beau")] })).toBe("a");
    expect(run({ filters: [f("txt", "ends_with", "REVOIR")] })).toBe("b");
    expect(run({ filters: [f("title", "is", "droit")] })).toBe("d");
    expect(run({ filters: [f("title", "is_not", "droit")] })).toBe("abc");
    expect(run({ filters: [f("txt", "empty")] })).toBe("cd");
    expect(run({ filters: [f("txt", "not_empty")] })).toBe("ab");
  });

  it("couvre =, ≠, <, ≤, >, ≥ et les anciens opérateurs", () => {
    expect(run({ filters: [f("n", "eq", "12")] })).toBe("ac");
    expect(run({ filters: [f("n", "neq", "12")] })).toBe("bd");
    expect(run({ filters: [f("n", "lt", "12")] })).toBe("d");
    expect(run({ filters: [f("n", "lte", "12")] })).toBe("acd");
    expect(run({ filters: [f("n", "gt", "12")] })).toBe("b");
    expect(run({ filters: [f("n", "gte", "12")] })).toBe("abc");
    expect(run({ filters: [f("n", "after", "12")] })).toBe("b");
    expect(run({ filters: [f("n", "is", "7")] })).toBe("d");
    expect(run({ filters: [f("n", "gt", "7,5")] })).toBe("abc");
    expect(run({ filters: [f("n", "gt", "abc")] })).toBe("abcd");
  });

  it("filtre sélections, sélection multiple et relation", () => {
    expect(run({ filters: [f("st", "is", "todo")] })).toBe("bd");
    expect(run({ filters: [f("tags", "contains", "a")] })).toBe("ab");
    expect(run({ filters: [f("tags", "contains", "b")] })).toBe("a");
    expect(run({ filters: [f("tags", "not_contains", "b")] })).toBe("bcd");
    expect(run({ filters: [f("tags", "not_empty")] })).toBe("ab");
    expect(run({ filters: [f("rel", "contains", "x")] })).toBe("a");
    expect(run({ filters: [f("rel", "not_contains", "x")] })).toBe("bcd");
  });
});

describe("filtres de dates", () => {
  it("compare jours, plages et heures", () => {
    expect(run({ filters: [f("d", "is", "2026-01-14")] })).toBe("b");
    expect(run({ filters: [f("d", "is", "2026-03-01")] })).toBe("d");
    expect(run({ filters: [f("d", "before", "2026-01-12")] })).toBe("a");
    expect(run({ filters: [f("d", "after", "2026-01-12")] })).toBe("bd");
    expect(run({ filters: [f("d", "on_or_before", "2026-01-10")] })).toBe("a");
    expect(run({ filters: [f("d", "on_or_after", "2026-01-16")] })).toBe("bd");
    expect(run({ filters: [f("d", "between", "2026-01-11", { value2: "2026-01-13" })] })).toBe("b");
    expect(run({ filters: [f("d", "between", "2026-01-20", { value2: "2026-01-05" })] })).toBe("ab");
    expect(run({ filters: [f("d", "empty")] })).toBe("c");
  });

  it("gère les dates relatives d'après aujourd'hui (14 janvier 2026, mercredi)", () => {
    expect(run({ filters: [f("d", "relative", "today")] })).toBe("b");
    expect(run({ filters: [f("d", "relative", "this_week")] })).toBe("b");
    expect(run({ filters: [f("d", "relative", "this_month")] })).toBe("ab");
    expect(run({ filters: [f("d", "relative", "past_7")] })).toBe("ab");
    expect(run({ filters: [f("d", "relative", "next_7")] })).toBe("b");
    expect(run({ filters: [f("d", "relative", "next_30")] })).toBe("b");
    expect(run({ filters: [f("d", "relative", "past_30")] })).toBe("ab");
    expect(run({ filters: [f("d", "relative", "next_month")] })).toBe("");
    expect(run({ filters: [f("d", "relative", "inconnu")] })).toBe("abcd");
  });

  it("filtre sur la date de création de la page", () => {
    expect(run({ filters: [f("cr", "relative", "this_month")] })).toBe("a");
    expect(run({ filters: [f("cr", "after", "2026-02-01")] })).toBe("bcd");
  });
});

describe("ET / OU et groupes", () => {
  it("combine en OU au premier niveau", () => {
    const filters = [f("st", "is", "done"), f("n", "lt", "10")];
    expect(run({ filters })).toBe("");
    expect(run({ filters, filterMode: "or" })).toBe("ad");
  });

  it("ignore les filtres incomplets au lieu de tout laisser passer en OU", () => {
    const filters = [f("txt", "contains", ""), f("st", "is", "done")];
    expect(run({ filters, filterMode: "or" })).toBe("a");
  });

  it("évalue un groupe imbriqué", () => {
    // statut = à faire ET (note ≥ 15 OU titre contient « droit »)
    const filters = [
      f("st", "is", "todo"),
      f("", "contains", "", { mode: "or", group: [f("n", "gte", "15"), f("title", "contains", "droit")] }),
    ];
    expect(run({ filters })).toBe("bd");
    expect(run({ filters: [filters[1]] })).toBe("bd");
    // Un groupe vide ne masque rien.
    expect(run({ filters: [f("", "contains", "", { group: [] })] })).toBe("abcd");
  });

  it("retire des groupes les filtres d'une propriété supprimée", () => {
    const config = {
      props,
      views: [view({ filters: [f("", "contains", "", { mode: "or", group: [f("n", "gt", "1")] }), f("st", "is", "todo")] })],
    };
    const next = removeProp(config, "n").views[0];
    expect(next.filters).toHaveLength(1);
    expect(next.filters[0].prop).toBe("st");
  });
});

describe("recherche rapide", () => {
  it("cherche dans le titre, les textes et les noms d'options", () => {
    const ids = (q: string) => searchRows(rows, q, props).map((r) => r.id).join("");
    expect(ids("")).toBe("abcd");
    expect(ids("DROIT")).toBe("d");
    expect(ids("revoir")).toBe("b");
    expect(ids("fait")).toBe("a");
    expect(ids("tp")).toBe("a");
    expect(ids("15")).toBe("b");
  });
});

describe("propriétés d'une vue", () => {
  it("ordonne et masque les propriétés, celles qui manquent venant ensuite", () => {
    const some = props.slice(0, 4);
    expect(orderedProps(some, { order: ["d", "st"] }).map((p) => p.id)).toEqual(["d", "st", "tags", "n"]);
    expect(orderedProps(some, {}).map((p) => p.id)).toEqual(["st", "tags", "n", "d"]);
    expect(orderedProps(some, { order: ["zzz", "n"] }).map((p) => p.id)).toEqual(["n", "st", "tags", "d"]);
    expect(visibleProps(some, { order: ["d"], hidden: ["tags"] }).map((p) => p.id)).toEqual(["d", "st", "n"]);
  });

  it("nettoie ordre, masquage, largeurs et calculs d'une propriété supprimée", () => {
    const v = view({
      order: ["n", "d"],
      hidden: ["n"],
      widths: { n: 120, d: 200 },
      calcs: { n: "sum", d: "latest" },
      sorts: [{ prop: "n", dir: "asc" }, { prop: "d", dir: "asc" }],
      sort: { prop: "n", dir: "asc" },
      groupBy: "n",
      collapsed: ["x"],
    });
    const next = removeProp({ props, views: [v] }, "n").views[0];
    expect(next.order).toEqual(["d"]);
    expect(next.hidden).toEqual([]);
    expect(next.widths).toEqual({ d: 200 });
    expect(next.calcs).toEqual({ d: "latest" });
    expect(viewSorts(next)).toEqual([{ prop: "d", dir: "asc" }]);
    expect(next.groupBy).toBeUndefined();
    expect(next.collapsed).toBeUndefined();
  });

  it("calcule la position d'une ligne déplacée", () => {
    const list = [row("a", "", {}, 10), row("b", "", {}, 20), row("c", "", {}, 30)];
    expect(positionBefore(list, "c", "a")).toBe(9);
    expect(positionBefore(list, "c", "b")).toBe(15);
    expect(positionBefore(list, "a", "c")).toBe(25);
    expect(positionBefore(list, "a", null)).toBe(31);
    expect(positionBefore(list, "a", "inconnue")).toBeNull();
  });

  it("n'enregistre pas les valeurs calculées", () => {
    expect(storedValues({ n: 1, cr: "x", f: 2 }, [...props, { id: "f", name: "F", type: "formula" }])).toEqual({ n: 1 });
  });
});

describe("regroupements", () => {
  const keys = (g: ReturnType<typeof groupRows>) => g.map((x) => `${x.key}:${x.rows.map((r) => r.id).join("")}`);
  it("groupe par sélection, avec ou sans groupes vides", () => {
    expect(keys(groupRows(rows, props[0]))).toEqual(["todo:bd", "done:a", ":c"]);
    const some = rows.filter((r) => r.id !== "d" && r.id !== "b");
    expect(keys(groupRows(some, props[0]))).toEqual(["done:a", ":c"]);
    expect(keys(groupRows(some, props[0], { keepEmpty: true, noneFirst: true }))).toEqual([":c", "todo:", "done:a"]);
  });

  it("place une ligne dans chaque groupe d'une sélection multiple", () => {
    expect(keys(groupRows(rows, props[1]))).toEqual(["a:ab", "b:a", ":cd"]);
  });

  it("groupe par case à cocher", () => {
    expect(keys(groupRows(rows, props[4]))).toEqual(["true:a", "false:bcd"]);
  });

  it("groupe par date : jour, semaine, mois", () => {
    expect(keys(groupRows(rows, props[3], { by: "month" }))).toEqual(["2026-01:ab", "2026-03:d", ":c"]);
    expect(keys(groupRows(rows, props[3], { by: "week", weekStart: 1 }))).toEqual([
      "2026-01-05:a",
      "2026-01-12:b",
      "2026-02-23:d",
      ":c",
    ]);
    expect(keys(groupRows(rows, props[3], { by: "day" }))).toEqual(["2026-01-10:a", "2026-01-12:b", "2026-03-01:d", ":c"]);
  });

  it("groupe par relation, ignore les lignes liées supprimées", () => {
    const titles: Record<string, string> = { x: "Zèbre", y: "Abeille" };
    const rel = props[6];
    const many = [row("1", "", { rel: ["x", "y"] }), row("2", "", { rel: ["y"] }), row("3", "", { rel: ["gone"] }), row("4", "", {})];
    const out = groupRows(many, rel, { titleOf: (id) => titles[id] ?? null });
    expect(keys(out)).toEqual(["y:12", "x:1", ":34"]);
  });

  it("déplace une ligne d'un groupe à l'autre selon le type", () => {
    expect(valueForGroup(props[0], "todo", "todo", "done")).toBe("done");
    expect(valueForGroup(props[0], "todo", "todo", "")).toBeNull();
    expect(valueForGroup(props[1], ["a", "b"], "a", "b")).toEqual(["b"]);
    expect(valueForGroup(props[1], ["a"], "a", "")).toBeNull();
    expect(valueForGroup(props[1], null, "", "a")).toEqual(["a"]);
    expect(valueForGroup(props[4], false, "false", "true")).toBe(true);
    expect(valueForGroup(props[3], "x", "", "2026-01")).toBeUndefined();
  });
});

describe("calculs en pied de colonne", () => {
  const n = rows.map((r) => r.props.n);
  it("compte, vides et pourcentages", () => {
    expect(computeCalc("count", n)).toEqual({ kind: "int", value: 4 });
    expect(computeCalc("values", rows.map((r) => r.props.txt))).toEqual({ kind: "int", value: 2 });
    expect(computeCalc("empty", rows.map((r) => r.props.txt))).toEqual({ kind: "int", value: 2 });
    expect(computeCalc("pct_empty", rows.map((r) => r.props.txt))).toEqual({ kind: "percent", value: 50 });
    expect(computeCalc("pct_not_empty", rows.map((r) => r.props.st))).toEqual({ kind: "percent", value: 75 });
    expect(computeCalc("unique", n)).toEqual({ kind: "int", value: 3 });
    expect(computeCalc("pct_empty", [])).toEqual({ kind: "percent", value: 0 });
  });

  it("agrège les nombres", () => {
    expect(computeCalc("sum", n)).toEqual({ kind: "number", value: 46 });
    expect(computeCalc("avg", n)).toEqual({ kind: "number", value: 11.5 });
    expect(computeCalc("median", n)).toEqual({ kind: "number", value: 12 });
    expect(computeCalc("median", [1, 2, 3])).toEqual({ kind: "number", value: 2 });
    expect(computeCalc("min", n)).toEqual({ kind: "number", value: 7 });
    expect(computeCalc("max", n)).toEqual({ kind: "number", value: 15 });
    expect(computeCalc("range", n)).toEqual({ kind: "number", value: 8 });
    expect(computeCalc("avg", [null, undefined])).toBeNull();
    expect(computeCalc("sum", [null])).toEqual({ kind: "number", value: 0 });
  });

  it("calcule dates et cases cochées", () => {
    const dates = rows.map((r) => r.props.d);
    expect(computeCalc("earliest", dates)).toEqual({ kind: "date", value: "2026-01-10" });
    expect(computeCalc("latest", dates)).toEqual({ kind: "date", value: "2026-03-01T14:30" });
    expect(computeCalc("earliest", [null])).toBeNull();
    const ok = rows.map((r) => r.props.ok);
    expect(computeCalc("checked", ok)).toEqual({ kind: "int", value: 1 });
    expect(computeCalc("unchecked", ok)).toEqual({ kind: "int", value: 3 });
    expect(computeCalc("pct_checked", ok)).toEqual({ kind: "percent", value: 25 });
  });

  it("propose des calculs adaptés au type", () => {
    expect(calcFnsFor("number")).toContain("median");
    expect(calcFnsFor("text")).not.toContain("sum");
    expect(calcFnsFor("date")).toContain("earliest");
    expect(calcFnsFor("checkbox")).toEqual(["count", "checked", "unchecked", "pct_checked"]);
    expect(calcFnsFor("title")).toContain("count");
  });
});

describe("format des nombres", () => {
  it("met en forme nombre, pourcentage et devises", () => {
    expect(formatNumber(1234.5, undefined, "fr")).toBe("1234.5");
    expect(formatNumber(1234.5, { decimals: 2 }, "en")).toBe("1234.50");
    expect(formatNumber(12.345, { format: "percent", decimals: 1 }, "en")).toBe("12.3 %");
    expect(formatNumber(25, { format: "percent" }, "fr")).toBe("25 %");
    expect(formatNumber(1234.5, { format: "eur" }, "en")).toBe("€1,234.50");
    expect(formatNumber(1234.5, { format: "usd", decimals: 0 }, "en")).toMatch(/^\$1,23[45]$/);
    expect(formatNumber(0.1 + 0.2, undefined, "en")).toBe("0.3");
  });
});

describe("rollups", () => {
  const base: RelatedBase = {
    props: [
      { id: "pts", name: "Points", type: "number" },
      { id: "cat", name: "Catégorie", type: "select", options: [{ id: "k1", name: "Maths", color: "blue" }] },
    ],
    rows: [
      row("x", "Algèbre", { pts: 10, cat: "k1" }),
      row("y", "Analyse", { pts: 20, cat: "k1" }),
      row("z", "Vide", {}),
    ],
  };
  const mine: Prop[] = [
    { id: "rel", name: "Cours", type: "relation", target: "other" },
    { id: "r1", name: "Somme", type: "rollup", rollupRelation: "rel", rollupProp: "pts", rollupFn: "sum" },
  ];
  const related = new Map([["other", base]]);
  const calc = (fn: string, prop = "pts", ids: string[] = ["x", "y", "z"]) =>
    withRollups(
      [row("1", "", { rel: ids })],
      [mine[0], { ...mine[1], rollupFn: fn as never, rollupProp: prop }],
      related,
    )[0].props.r1;

  it("agrège les lignes liées", () => {
    expect(calc("sum")).toBe(30);
    expect(calc("avg")).toBe(15);
    expect(calc("min")).toBe(10);
    expect(calc("max")).toBe(20);
    expect(calc("count")).toBe(3);
    expect(calc("list", "title")).toBe("Algèbre, Analyse, Vide");
    expect(calc("list", "cat")).toBe("Maths");
  });

  it("gère l'absence de lignes liées ou de base", () => {
    expect(calc("sum", "pts", [])).toBe(0);
    expect(calc("avg", "pts", [])).toBeNull();
    expect(calc("count", "pts", [])).toBe(0);
    expect(calc("sum", "pts", ["supprimée"])).toBe(0);
    const none = withRollups([row("1", "", { rel: ["x"] })], mine, new Map());
    expect(none[0].props.r1).toBeNull();
  });

  it("laisse une formule se servir d'un cumul", () => {
    const withFormula: Prop[] = [...mine, { id: "f", name: "Double", type: "formula", formula: "{Somme} * 2" }];
    const [result] = withComputed([row("1", "", { rel: ["x", "y"] })], withFormula, related);
    expect(result.props.r1).toBe(30);
    expect(result.props.f).toBe(60);
  });

  it("liste les bases nécessaires et laisse passer les lignes sans rollup", () => {
    expect(rollupTargets(mine)).toEqual(["other"]);
    expect(rollupTargets(props)).toEqual([]);
    expect(withRollups(rows, props, related)).toBe(rows);
  });
});

describe("dates de création et de modification", () => {
  it("sont calculées à partir de la ligne", () => {
    const out = withFormulas(rows, [props[7], { id: "m", name: "Modifié", type: "last_edited_time" }]);
    expect(out[0].props.cr).toBe("2026-01-02T10:00");
    expect(out[0].props.m).toBe("2026-01-02T10:00");
  });
});

describe("conversion de type", () => {
  const cells = (values: (string | number | null)[]) => values.map((value, i) => ({ id: String(i), value }));
  const ids = () => {
    let i = 0;
    return () => `o${i++}`;
  };

  it("propose des conversions qui ont un sens", () => {
    expect(convertTargets("text")).toContain("number");
    expect(convertTargets("select")).toEqual(["text", "multi_select"]);
    expect(convertTargets("relation")).toEqual([]);
    expect(convertTargets("formula")).toContain("text");
  });

  it("convertit texte vers nombre, en vidant ce qui n'est pas un nombre", () => {
    const { prop, values } = convertColumn(cells(["12", "3,5", "abc", ""]), { id: "p", name: "P", type: "text" }, "number");
    expect(prop).toMatchObject({ id: "p", name: "P", type: "number" });
    expect([...values.values()]).toEqual([12, 3.5, null, null]);
  });

  it("convertit texte vers sélection en créant les options", () => {
    const { prop, values } = convertColumn(cells(["Maths", "maths", "Physique", ""]), { id: "p", name: "P", type: "text" }, "select", ids());
    expect(prop.options?.map((o) => o.name)).toEqual(["Maths", "Physique"]);
    expect([...values.values()]).toEqual(["o0", "o0", "o1", null]);
  });

  it("convertit vers sélection multiple en séparant les valeurs", () => {
    const { prop, values } = convertColumn(cells(["a, b", "b;c"]), { id: "p", name: "P", type: "text" }, "multi_select", ids());
    expect(prop.options?.map((o) => o.name)).toEqual(["a", "b", "c"]);
    expect([...values.values()]).toEqual([["o0", "o1"], ["o1", "o2"]]);
  });

  it("convertit entre sélection simple et multiple en gardant les options", () => {
    const from = props[1];
    const { prop, values } = convertColumn(
      [{ id: "1", value: ["a", "b"] as never }, { id: "2", value: null }],
      from,
      "select",
    );
    expect(prop.options).toBe(from.options);
    expect([...values.values()]).toEqual(["a", null]);
    const back = convertColumn([{ id: "1", value: "a" }], props[0], "multi_select");
    expect([...back.values.values()]).toEqual([["a"]]);
  });

  it("convertit une sélection en texte avec les noms des options", () => {
    const { values } = convertColumn([{ id: "1", value: ["a", "b"] as never }], props[1], "text");
    expect(values.get("1")).toBe("Cours, TP");
  });

  it("convertit texte vers date et case à cocher", () => {
    const date = convertColumn(cells(["2026-01-05", "31/12/2026", "demain peut-être"]), { id: "p", name: "P", type: "text" }, "date");
    expect([...date.values.values()]).toEqual(["2026-01-05", "2026-12-31", null]);
    const box = convertColumn(cells(["oui", "non", ""]), { id: "p", name: "P", type: "text" }, "checkbox");
    expect([...box.values.values()]).toEqual([true, false, false]);
  });

  it("fige une valeur calculée en texte ou en nombre", () => {
    const num = convertColumn(cells([4, null]), { id: "p", name: "P", type: "formula" }, "number");
    expect([...num.values.values()]).toEqual([4, null]);
    const txt = convertColumn(cells([4]), { id: "p", name: "P", type: "formula" }, "text");
    expect(txt.values.get("0")).toBe("4");
  });
});
