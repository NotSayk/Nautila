import { describe, expect, it } from "vitest";
import type { Key } from "../i18n";
import { logoutOthersNotice } from "./notices";

describe("déconnexion des autres appareils", () => {
  // Textes de l'interface simulés (src/i18n.ts charge le magasin de l'application, qui lit l'adresse).
  const t = (key: Key) =>
    ({ logoutOthersDone: "Sessions fermées :", logoutOthersMcp: "jetons de connecteur IA révoqués :" })[key as string] ??
    key;

  it("indique aussi les jetons du connecteur IA révoqués", () => {
    expect(logoutOthersNotice({ revoked: 2, mcp: 1 }, t)).toBe(
      "Sessions fermées : 2 · jetons de connecteur IA révoqués : 1",
    );
    expect(logoutOthersNotice({ revoked: 0, mcp: 0 }, t)).toContain("jetons de connecteur IA révoqués : 0");
  });

  it("reste lisible avec un serveur plus ancien", () => {
    expect(logoutOthersNotice({ revoked: 3 }, t)).toBe("Sessions fermées : 3");
  });
});
