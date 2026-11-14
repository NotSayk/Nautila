import { describe, expect, it } from "vitest";
import { fromAnkiMath, htmlToText, parseAnkiText, toAnkiText } from "./anki";
import { splitMath } from "./mathtext";

describe("formules dans le texte", () => {
  it("repère $…$ en ligne et $$…$$ en bloc", () => {
    expect(splitMath("Aire $\\pi r^2$ et $$\\int_0^1 x\\,dx$$ fin")).toEqual([
      { kind: "text", text: "Aire " },
      { kind: "math", tex: "\\pi r^2", display: false },
      { kind: "text", text: " et " },
      { kind: "math", tex: "\\int_0^1 x\\,dx", display: true },
      { kind: "text", text: " fin" },
    ]);
  });

  it("laisse les prix, les dollars échappés et les formules non fermées en texte", () => {
    expect(splitMath("5 $ et 10 $")).toEqual([{ kind: "text", text: "5 $ et 10 $" }]);
    expect(splitMath("coûte $5 et $10")).toEqual([{ kind: "text", text: "coûte $5 et $10" }]);
    expect(splitMath("\\$x\\$")).toEqual([{ kind: "text", text: "$x$" }]);
    expect(splitMath("$$ ouvert")).toEqual([{ kind: "text", text: "$$ ouvert" }]);
  });

  it("une balise dans le texte reste du texte (React l'échappe à l'affichage)", () => {
    expect(splitMath("<img src=x onerror=alert(1)> $a$")[0]).toEqual({
      kind: "text",
      text: "<img src=x onerror=alert(1)> ",
    });
  });
});

describe("format texte d'Anki", () => {
  it("lit les en-têtes, les colonnes ignorées et les champs entre guillemets", () => {
    const text = [
      "#separator:tab",
      "#html:true",
      "#guid column:1",
      "#notetype column:2",
      'g1\tBasic\tCapitale<br>de la France\t"Paris, ""ville lumière"""',
      "g2\tCloze\t{{c1::Rome}} est en Italie\t",
      'g3\tBasic\t"Sur deux',
      'lignes"\tR&eacute;ponse &amp; plus',
      "",
    ].join("\n");
    expect(parseAnkiText(text)).toEqual([
      { front: "Capitale\nde la France", back: 'Paris, "ville lumière"' },
      { front: "{{c1::Rome}} est en Italie", back: "" },
      { front: "Sur deux\nlignes", back: "Réponse & plus" },
    ]);
  });

  it("sans en-tête : tabulation, sinon point-virgule ; lignes incomplètes ignorées", () => {
    expect(parseAnkiText("﻿a\tb\nseul\n\nc\td")).toEqual([
      { front: "a", back: "b" },
      { front: "c", back: "d" },
    ]);
    expect(parseAnkiText("#separator:Semicolon\nq;r")).toEqual([{ front: "q", back: "r" }]);
    expect(parseAnkiText("q;r")).toEqual([{ front: "q", back: "r" }]);
  });

  it("convertit le HTML et les formules MathJax d'Anki", () => {
    expect(htmlToText("<div>a</div><div>b&nbsp;&lt;c&gt; &#233;</div>")).toBe("a\nb <c> é");
    expect(fromAnkiMath("\\(x^2\\) et \\[y\\] et [$]z[/$]")).toBe("$x^2$ et $$y$$ et $z$");
    expect(parseAnkiText("#html:false\n<b>gras</b>\t\\(e^{i\\pi}\\)")).toEqual([
      { front: "<b>gras</b>", back: "$e^{i\\pi}$" },
    ]);
  });

  it("exporte puis réimporte sans perte", () => {
    const cards = [
      { front: "Aire du disque", back: "$\\pi r^2$" },
      { front: "Deux\tchamps", back: 'avec "guillemets"\net retour' },
      { front: "{{c1::Paris}}", back: "" },
    ];
    const text = toAnkiText(cards);
    expect(text.split("\n").slice(0, 3)).toEqual(["#separator:tab", "#html:false", "#notetype column:3"]);
    expect(text).toContain("\\(\\pi r^2\\)");
    expect(parseAnkiText(text)).toEqual(cards);
    expect(toAnkiText([{ front: "{{c1::a}}", back: "" }])).toContain("#notetype:Cloze");
  });
});
