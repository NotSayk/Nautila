import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migratedDb } from "../db/testdb";
import { listVersions, snapshot, snapshotStatements, versionsToDrop } from "./versions";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 5, 15, 12, 30);

const rows = (ages: number[]) => ages.map((age, i) => ({ id: `v${i}`, created_at: NOW - age }));
const kept = (list: ReturnType<typeof rows>) => {
  const dropped = new Set(versionsToDrop(list, NOW));
  return list.filter((r) => !dropped.has(r.id)).map((r) => r.id);
};

describe("amincissement de l'historique", () => {
  it("garde toutes les versions des dernières heures", () => {
    const list = rows([0, 10 * MIN, 20 * MIN, 90 * MIN, 170 * MIN]);
    expect(kept(list)).toEqual(list.map((r) => r.id));
  });

  it("ne garde qu'une version par heure ensuite, la plus récente de l'heure", () => {
    // Trois versions dans la même heure, il y a 5 h : seule la plus récente reste.
    const base = NOW - 5 * HOUR;
    const hour = base - (base % HOUR);
    const list = [
      { id: "a", created_at: hour + 5 * MIN },
      { id: "b", created_at: hour + 25 * MIN },
      { id: "c", created_at: hour + 45 * MIN },
      { id: "d", created_at: hour - 20 * MIN },
    ];
    expect(kept(list).sort()).toEqual(["c", "d"]);
  });

  it("ne garde qu'une version par jour après deux jours, et plus rien après soixante jours", () => {
    const day = NOW - 10 * DAY - ((NOW - 10 * DAY) % DAY);
    const list = [
      { id: "a", created_at: day + 1 * HOUR },
      { id: "b", created_at: day + 9 * HOUR },
      { id: "c", created_at: day - DAY + 3 * HOUR },
      { id: "vieille", created_at: NOW - 90 * DAY },
    ];
    expect(kept(list).sort()).toEqual(["b", "c"]);
  });

  it("respecte un plafond, en retirant les plus anciennes", () => {
    const list = rows(Array.from({ length: 400 }, (_, i) => i * 3 * MIN)); // 400 versions sur 20 h
    const remaining = kept(list);
    expect(remaining.length).toBeLessThanOrEqual(120);
    expect(remaining).toContain("v0");
    expect(remaining).not.toContain("v399");
  });
});

describe("snapshot", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await migratedDb();
  });
  afterEach(() => vi.useRealTimers());

  it("ne crée une version que si le contenu change et au plus toutes les dix minutes", async () => {
    expect((await snapshotStatements("p", "A", "a")).length).toBe(1);
    await snapshot("p", "A", "a");
    await snapshot("p", "B", "b"); // moins de dix minutes plus tard : ignoré
    expect((await listVersions("p")).length).toBe(1);
    vi.setSystemTime(NOW + 1000);
    await snapshot("p", "B", "b", true);
    expect((await listVersions("p")).map((v) => v.ydoc)).toEqual(["B", "A"]);
    await snapshot("p", "B", "b", true); // contenu identique : ignoré
    expect((await listVersions("p")).length).toBe(2);
  });
});
