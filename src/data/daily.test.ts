import { describe, expect, it } from "vitest";
import { migratedDb } from "../db/testdb";
import { dailyId, dailyNote, dailyPosition, dailyTitle, JOURNAL_ID } from "./daily";
import { trashPage } from "./pages";
import { keyNoon } from "./stats";

describe("note du jour", () => {
  it("titre la page avec la date dans la langue de l'interface", () => {
    expect(dailyTitle("2026-11-14", "fr")).toBe("Samedi 14 novembre 2026");
    expect(dailyTitle("2026-11-14", "en")).toBe("Saturday, November 14, 2026");
  });

  it("range les jours les plus récents en tête", () => {
    expect(dailyPosition("2026-11-15")).toBeLessThan(dailyPosition("2026-11-14"));
  });

  it("crée le journal et la page du jour une seule fois, même sur un double clic", async () => {
    const db = await migratedDb();
    const now = keyNoon("2026-11-14");
    const [a, b] = await Promise.all([dailyNote("fr", "Journal", now), dailyNote("fr", "Journal", now)]);
    expect(a).toBe(dailyId("2026-11-14"));
    expect(b).toBe(a);
    expect(await dailyNote("fr", "Journal", now + 3600_000)).toBe(a);
    const rows = await db.all<{ id: string; parent_id: string | null; title: string }>(
      "SELECT id, parent_id, title FROM pages ORDER BY id",
    );
    expect(rows).toEqual([
      { id: JOURNAL_ID, parent_id: null, title: "Journal" },
      { id: "journal-2026-11-14", parent_id: JOURNAL_ID, title: "Samedi 14 novembre 2026" },
    ]);
  });

  it("ressort de la corbeille la page du jour et son journal", async () => {
    const db = await migratedDb();
    const now = keyNoon("2026-11-14");
    await dailyNote("fr", "Journal", now);
    await trashPage(JOURNAL_ID);
    await dailyNote("fr", "Journal", now);
    const rows = await db.all<{ id: string; deleted_at: number | null }>("SELECT id, deleted_at FROM pages ORDER BY id");
    expect(rows).toEqual([
      { id: JOURNAL_ID, deleted_at: null },
      { id: "journal-2026-11-14", deleted_at: null },
    ]);
  });
});
