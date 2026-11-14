import { describe, expect, it } from "vitest";
import { MAX_ROW_BYTES, nextBatch, onPushError, PUSH_BYTES, type Pending } from "./batch";

const rows = (n: number): Pending[] => Array.from({ length: n }, (_, i) => ({ tbl: "files", id: `f${i}`, at: i }));

describe("lots d'envoi", () => {
  it("borne un lot en nombre de lignes et en taille", async () => {
    const small = await nextBatch(rows(50), async (p) => ({ id: p.id }), 40);
    expect(small.changes).toHaveLength(40);
    const big = "x".repeat(PUSH_BYTES / 3);
    const heavy = await nextBatch(rows(10), async () => ({ big }), 40);
    expect(heavy.changes).toHaveLength(2);
  });

  it("envoie seule une ligne plus grosse qu'un lot, et met de côté celle que le serveur refuserait", async () => {
    const huge = "x".repeat(PUSH_BYTES + 10);
    const alone = await nextBatch(rows(3), async () => ({ huge }), 40);
    expect(alone.changes.map((c) => c.id)).toEqual(["f0"]);
    const tooBig = "x".repeat(MAX_ROW_BYTES + 10);
    const skipped = await nextBatch(rows(3), async (p) => (p.id === "f1" ? { tooBig } : { id: p.id }), 40);
    expect(skipped.oversized.map((p) => p.id)).toEqual(["f1"]);
    expect(skipped.changes.map((c) => c.id)).toEqual(["f0", "f2"]);
  });

  it("découpe un lot refusé puis isole la ligne fautive", () => {
    expect(onPushError(413, "body too large", 12)).toBe("split");
    expect(onPushError(400, "invalid change", 1)).toBe("skip");
    expect(onPushError(413, "quota exceeded", 1)).toBe("quota");
    expect(onPushError(401, "unauthorized", 1)).toBe("fail");
    expect(onPushError(500, "server error", 1)).toBe("fail");
  });
});
