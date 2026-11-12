import { describe, expect, it } from "vitest";
import { notionTitle, splitMarkdown } from "./importer";

describe("import", () => {
  it("prend le premier titre comme titre de page", () => {
    expect(splitMarkdown("# Cours 1\n\nTexte", "fichier")).toEqual({ title: "Cours 1", body: "\nTexte" });
    expect(splitMarkdown("Texte sans titre", "fichier")).toEqual({ title: "fichier", body: "Texte sans titre" });
  });

  it("nettoie les noms de fichiers d'un export Notion", () => {
    expect(notionTitle("Semestre 1 0123456789abcdef0123456789abcdef/Analyse fedcba9876543210fedcba9876543210.md")).toBe(
      "Analyse",
    );
    expect(notionTitle("Notes.md")).toBe("Notes");
  });
});
