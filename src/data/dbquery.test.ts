import { describe, expect, it } from "vitest";
import { applyView, type DbView, type Prop, type Row } from "./dbquery";

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
