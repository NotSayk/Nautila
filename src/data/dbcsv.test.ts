import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { cellText, exportTable, planImport, toCsv, type ExportContext } from "./dbcsv";
import type { Prop, Row } from "./dbquery";

const ctx: ExportContext = {
  labels: { title: "Nom", yes: "Oui", no: "Non" },
  titleOf: (id) => ({ p1: "Maths", p2: "Physique" })[id] ?? null,
  fileName: (url) => (url === "nautila-file:1" ? "cours.pdf" : null),
};

const props: Prop[] = [
  { id: "n", name: "Note", type: "number" },
  {
    id: "s",
    name: "Statut",
    type: "select",
    options: [
      { id: "o1", name: "À faire", color: "gray" },
      { id: "o2", name: "Fini", color: "green" },
    ],
  },
  {
    id: "m",
    name: "Tags",
    type: "multi_select",
    options: [
      { id: "t1", name: "a", color: "gray" },
      { id: "t2", name: "b", color: "blue" },
    ],
  },
  { id: "k", name: "Fait", type: "checkbox" },
  { id: "d", name: "Date", type: "date" },
  { id: "r", name: "Matières", type: "relation", target: "x" },
  { id: "f", name: "Pièces", type: "files" },
  { id: "c", name: "Créé", type: "created_time" },
];

const row = (over: Partial<Row> & { props?: Row["props"] }): Row => ({
  id: "r1",
  title: "Devoir, n°1",
  icon: null,
  cover: null,
  position: 0,
  created_at: new Date(2026, 0, 2, 9, 30).getTime(),
  updated_at: 0,
  props: {},
  ...over,
});

describe("écriture CSV", () => {
  it("met entre guillemets ce qui en a besoin, et double les guillemets", () => {
    expect(toCsv([["a", "b,c", 'd"e', "f\ng", " h"]])).toBe('﻿a,"b,c","d""e","f\ng"," h"\r\n');
  });

  it("se relit à l'identique", () => {
    const table = [
      ["x", "y"],
      ['a "b"', "c,d\ne"],
    ];
    expect(parseCsv(toCsv(table))).toEqual(table);
  });
});

describe("export d'une base", () => {
  it("écrit les noms des choix, les titres liés, les fichiers et les cases", () => {
    const r = row({
      props: {
        n: 12.5,
        s: "o2",
        m: ["t1", "t2"],
        k: true,
        d: "2026-02-03T10:00/2026-02-05",
        r: ["p1", "px", "p2"],
        f: ["nautila-file:1", "nautila-file:9"],
      },
    });
    expect(props.map((p) => cellText(p, r, ctx))).toEqual([
      "12.5",
      "Fini",
      "a, b",
      "Oui",
      "2026-02-03T10:00/2026-02-05",
      "Maths, Physique",
      "cours.pdf",
      "2026-01-02T09:30",
    ]);
    expect(cellText(props[3], row({}), ctx)).toBe("Non");
    expect(cellText(props[0], row({}), ctx)).toBe("");
  });

  it("commence par l'en-tête, titre en premier", () => {
    const table = exportTable(props.slice(0, 2), [row({ props: { n: 3, s: "o1" } })], ctx);
    expect(table).toEqual([
      ["Nom", "Note", "Statut"],
      ["Devoir, n°1", "3", "À faire"],
    ]);
  });
});

describe("import dans une base", () => {
  let n = 0;
  const newId = () => `id${++n}`;

  it("associe les colonnes aux propriétés de même nom et complète les choix", () => {
    const plan = planImport(
      parseCsv("TITRE,note,STATUT,Tags,Fait,Date\nUn,\"12,5\",Fini,\"a, c\",oui,2026-02-03\nDeux,,Nouveau,,non,"),
      props,
      newId,
    )!;
    expect(plan.added).toEqual([]);
    expect(plan.items[0]).toMatchObject({ title: "Un", props: { n: 12.5, s: "o2", k: true, d: "2026-02-03" } });
    const tags = plan.props.find((p) => p.id === "m")!;
    expect(tags.options?.map((o) => o.name)).toEqual(["a", "b", "c"]);
    expect(plan.items[0].props.m).toEqual(["t1", tags.options![2].id]);
    const status = plan.props.find((p) => p.id === "s")!;
    expect(status.options?.map((o) => o.name)).toEqual(["À faire", "Fini", "Nouveau"]);
    expect(plan.items[1].props).toEqual({ s: status.options![2].id });
    // La base d'origine n'est pas modifiée.
    expect(props[1].options).toHaveLength(2);
  });

  it("crée une propriété pour une colonne inconnue, de type déduit", () => {
    const plan = planImport(parseCsv("Nom,Points,Lien\nA,3,https://a.fr\nB,4,https://b.fr"), [], newId)!;
    expect(plan.props.map((p) => [p.name, p.type])).toEqual([
      ["Points", "number"],
      ["Lien", "url"],
    ]);
    expect(plan.added).toHaveLength(2);
    expect(plan.items[1]).toEqual({ title: "B", props: { [plan.props[0].id]: 4, [plan.props[1].id]: "https://b.fr" } });
  });

  it("prend la première colonne pour titre à défaut de colonne « Nom »", () => {
    const plan = planImport(parseCsv("Sujet,Note\nMaths,12"), props, newId)!;
    expect(plan.items[0].title).toBe("Maths");
    expect(plan.items[0].props).toEqual({ n: 12 });
  });

  it("laisse de côté les colonnes calculées, les relations et les colonnes vides sans nom", () => {
    const plan = planImport(parseCsv("Nom,Matières,Créé,,Note\nA,Maths,2020-01-01,,5"), props, newId)!;
    expect(plan.skipped).toEqual(["Matières", "Créé"]);
    expect(plan.added).toEqual([]);
    expect(plan.items[0].props).toEqual({ n: 5 });
  });

  it("relit une date écrite par l'export, avec heure et plage", () => {
    const plan = planImport(parseCsv("Nom,Date\nA,2026-02-03T10:00/2026-02-05"), props, newId)!;
    expect(plan.items[0].props.d).toBe("2026-02-03T10:00/2026-02-05");
  });

  it("refuse un fichier sans ligne", () => {
    expect(planImport([], props, newId)).toBeNull();
    expect(planImport(parseCsv("Nom,Note"), props, newId)).toBeNull();
  });

  it("tolère les lignes plus courtes que l'en-tête", () => {
    const plan = planImport([["Nom", "Note"], ["A"]], props, newId)!;
    expect(plan.items[0]).toEqual({ title: "A", props: {} });
  });
});
