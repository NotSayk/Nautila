import { describe, expect, it } from "vitest";
import type { Key } from "../i18n";
import { emptySources, type ExportBlock } from "./html";
import { markdownBlocks } from "./markdown";

const LABELS: Partial<Record<Key, string>> = { untitled: "Sans titre", question: "Question", answer: "Réponse" };
const t = (key: Key) => LABELS[key] ?? key;
const text = (value: string) => ({ type: "text", text: value, styles: {} });

describe("markdownBlocks", () => {
  const sources = emptySources();
  sources.pages.set("p", { title: "Autre page", icon: null });
  sources.refs = [{ key: "k", author: "Ada Lovelace", title: "Notes", year: "1843", bibtex: "" }];
  sources.synced.set("s", [{ id: "x", type: "paragraph", content: [text("partagé")] }]);
  const blocks: ExportBlock[] = [
    {
      id: "a",
      type: "paragraph",
      content: [
        text("Soit \uFFFC"),
        { type: "math", props: { latex: "a_1 * b" } },
        text(", voir "),
        { type: "pageLink", props: { pageId: "p" } },
        text(" "),
        { type: "cite", props: { key: "k" } },
      ],
    },
    { id: "m", type: "mathBlock", props: { latex: "\\frac{1}{2}", numbered: true } },
    { id: "sy", type: "syncedBlock", props: { sourceId: "s" } },
    { id: "f", type: "flashcard", props: { front: "Q1", back: "R1" } },
    { id: "toc", type: "toc" },
    { id: "li", type: "bulletListItem", content: [text("￼")] },
    { id: "bib", type: "bibliography" },
  ];
  const { blocks: out, restore } = markdownBlocks(blocks, sources, t);

  it("ramène les blocs propres à Nautila à des blocs standards", () => {
    expect(out.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph", "quote", "paragraph"]);
    const words = JSON.stringify(out);
    expect(words).toContain("Autre page");
    expect(words).toContain("(Lovelace, 1843)");
    expect(words).toContain("partagé");
    expect(words).toContain("Ada Lovelace (1843). ");
    expect(words).not.toContain("\uFFFC");
  });

  it("remet les formules en $…$ et $$…$$ après conversion", () => {
    // Conversion simulée : seuls les repères comptent.
    const markdown = out
      .map((b) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : ""))
      .join("\n\n");
    const restored = restore(`${markdown}\uFFFC`);
    expect(restored).toContain("Soit $a_1 * b$, voir Autre page");
    expect(restored).toContain("$$\n\\frac{1}{2} \\tag{1}\n$$");
    expect(restored).not.toContain("NautilaFormula");
    expect(restored).not.toContain("\uFFFC");
  });
});
