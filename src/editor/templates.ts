import type { Lang } from "../i18n";
import type { NautilaBlock } from "./schema";

const h = (text: string, level: 1 | 2 | 3 = 2): NautilaBlock => ({ type: "heading", props: { level }, content: text });
const p = (text = ""): NautilaBlock => ({ type: "paragraph", content: text });
const li = (text = ""): NautilaBlock => ({ type: "bulletListItem", content: text });
const todo = (text = ""): NautilaBlock => ({ type: "checkListItem", content: text });
const card = (): NautilaBlock => ({ type: "flashcard", props: { front: "", back: "" } });

export type TemplateId = "lecture" | "cornell" | "revision" | "lab";

export function template(id: TemplateId, lang: Lang): NautilaBlock[] {
  const fr = lang === "fr";
  switch (id) {
    case "lecture":
      return [
        h(fr ? "Objectifs du cours" : "Lecture goals"),
        li(),
        h(fr ? "Notes" : "Notes"),
        p(),
        h(fr ? "À retenir" : "Key takeaways"),
        li(),
        h(fr ? "Questions à poser" : "Questions to ask"),
        todo(),
      ];
    case "cornell":
      return [
        h(fr ? "Mots-clés et questions" : "Cues & questions"),
        li(),
        h(fr ? "Notes" : "Notes"),
        p(),
        h(fr ? "Résumé" : "Summary"),
        p(fr ? "En quelques phrases, avec tes propres mots." : "A few sentences, in your own words."),
      ];
    case "revision":
      return [
        h(fr ? "Définitions" : "Definitions"),
        li(),
        h(fr ? "Formules clés" : "Key formulas"),
        { type: "mathBlock", props: { latex: "" } },
        h(fr ? "Erreurs fréquentes" : "Common mistakes"),
        li(),
        h(fr ? "Cartes à réviser" : "Cards to review"),
        card(),
        card(),
      ];
    case "lab":
      return [
        h(fr ? "Objectif" : "Objective"),
        p(),
        h(fr ? "Matériel" : "Equipment"),
        li(),
        h(fr ? "Protocole" : "Procedure"),
        { type: "numberedListItem", content: "" },
        h(fr ? "Résultats" : "Results"),
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: [fr ? "Mesure" : "Measurement", fr ? "Valeur" : "Value", fr ? "Unité" : "Unit"] }, { cells: ["", "", ""] }],
          },
        },
        h(fr ? "Analyse" : "Analysis"),
        p(),
        h("Conclusion"),
        p(),
      ];
  }
}
