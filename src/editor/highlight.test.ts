import { describe, expect, it } from "vitest";
import { codeTokens } from "./highlight";

describe("codeTokens", () => {
  it("découpe le code en jetons colorés du thème clair", async () => {
    const lines = await codeTokens("const a = 1;\nlet b = 2;", "javascript");
    expect(lines).toHaveLength(2);
    expect(lines![0].map((t) => t.content).join("")).toBe("const a = 1;");
    expect(lines![0].some((t) => /^#[0-9a-f]{6}$/i.test(t.color ?? ""))).toBe(true);
  });

  it("renvoie null pour du texte brut ou un langage inconnu", async () => {
    expect(await codeTokens("x", "text")).toBeNull();
    expect(await codeTokens("x", "klingon")).toBeNull();
  });
});
