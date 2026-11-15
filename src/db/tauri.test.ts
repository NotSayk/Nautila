import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Greffon SQL et pont Tauri simulés : on vérifie par où passent les requêtes.
const invoke = vi.fn(async (command: string) => (command === "db_select" ? [{ n: 1 }] : undefined));
const plugin = { execute: vi.fn(), select: vi.fn() };
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: async () => plugin } }));

const { openTauriDb } = await import("./tauri");

describe("base de l'application de bureau", () => {
  it("passe lectures et écritures par les commandes Rust qui vérifient le SQL", async () => {
    const db = await openTauriDb();
    await db.run("UPDATE pages SET title = ? WHERE id = ?", ["T", "p"]);
    expect(await db.all("SELECT 1 AS n")).toEqual([{ n: 1 }]);
    expect(invoke).toHaveBeenCalledWith("db_execute", { sql: "UPDATE pages SET title = ? WHERE id = ?", params: ["T", "p"] });
    expect(invoke).toHaveBeenCalledWith("db_select", { sql: "SELECT 1 AS n", params: [] });
    expect(plugin.execute).not.toHaveBeenCalled();
    expect(plugin.select).not.toHaveBeenCalled();
  });

  it("ne donne plus à la fenêtre le droit d'exécuter du SQL libre", () => {
    const capabilities = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
    expect(capabilities.permissions).not.toContain("sql:allow-execute");
    expect(capabilities.permissions).not.toContain("sql:allow-select");
  });
});
