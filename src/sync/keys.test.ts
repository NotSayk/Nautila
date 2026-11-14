import { describe, expect, it } from "vitest";
import { keyValues, keyWhere } from "./keys";

describe("clés des lignes synchronisées", () => {
  it("ne découpe pas une clé simple qui contient des « | »", () => {
    // Identifiant d'un cours importé d'iCal : `${calendar}|${uid}`.
    expect(keyValues("events", "cal-1|uid-42|2026-01-05")).toEqual(["cal-1|uid-42|2026-01-05"]);
    expect(keyValues("pages", "p1")).toEqual(["p1"]);
    expect(keyWhere("events")).toBe("id = ?");
  });

  it("découpe une clé composée en autant de valeurs que de colonnes", () => {
    expect(keyValues("links", "a|b")).toEqual(["a", "b"]);
    expect(keyValues("page_files", "page|fichier|avec|barres")).toEqual(["page", "fichier|avec|barres"]);
    expect(keyValues("links", "seul")).toEqual(["seul", ""]);
    expect(keyWhere("links")).toBe("source_id = ? AND target_id = ?");
  });
});
