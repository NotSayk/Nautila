import { describe, expect, it } from "vitest";
import { parseCardList } from "./cards";
import { cleanQuestions } from "./quizzes";

describe("création de cartes et de quiz", () => {
  it("lit une liste de cartes collée", () => {
    expect(
      parseCardList("Capitale de l'Italie ; Rome\nH2O - Eau\n\nmot\ttraduction\nligne sans séparateur\n2 + 2 : 4\n ; vide"),
    ).toEqual([
      { front: "Capitale de l'Italie", back: "Rome" },
      { front: "H2O", back: "Eau" },
      { front: "mot", back: "traduction" },
      { front: "2 + 2", back: "4" },
    ]);
  });

  it("nettoie les questions d'un quiz et recale la bonne réponse", () => {
    expect(
      cleanQuestions([{ question: " Q ", choices: ["", "a", " ", "b"], answer: 3, explanation: " " }]),
    ).toEqual([{ question: "Q", choices: ["a", "b"], answer: 1 }]);
    // La bonne réponse cochée est vide, ou il manque un choix : la question est incomplète.
    expect(cleanQuestions([{ question: "Q", choices: ["", "a", "b"], answer: 0 }])).toBeNull();
    expect(cleanQuestions([{ question: "Q", choices: ["a", ""], answer: 0 }])).toBeNull();
    expect(cleanQuestions([])).toBeNull();
  });
});
