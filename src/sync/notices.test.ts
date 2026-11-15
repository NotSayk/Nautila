import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { logoutOthersNotice } from "./notices";

describe("déconnexion des autres appareils", () => {
  const t = (key: Parameters<typeof translate>[1]) => translate("fr", key);

  it("indique aussi les jetons du connecteur IA révoqués", () => {
    expect(logoutOthersNotice({ revoked: 2, mcp: 1 }, t)).toBe(
      "Sessions fermées sur les autres appareils : 2 · jetons de connecteur IA révoqués : 1",
    );
    expect(logoutOthersNotice({ revoked: 0, mcp: 0 }, t)).toContain("jetons de connecteur IA révoqués : 0");
  });

  it("reste lisible avec un serveur plus ancien", () => {
    expect(logoutOthersNotice({ revoked: 3 }, t)).toBe("Sessions fermées sur les autres appareils : 3");
  });
});
