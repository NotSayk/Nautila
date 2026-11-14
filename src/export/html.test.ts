import { describe, expect, it } from "vitest";
import type { Key } from "../i18n";
import {
  anchorId,
  codeKey,
  collectNeeds,
  emptySources,
  escapeHtml,
  renderBlocksHtml,
  renderPageHtml,
  type ExportBlock,
  type ExportPage,
  type ExportSources,
} from "./html";

// Libellés de l'interface (i18n.ts dépend du store, qui demande un navigateur).
const LABELS: Partial<Record<Key, string>> = {
  untitled: "Sans titre",
  question: "Question",
  answer: "Réponse",
  audioNote: "Enregistrement audio",
  name: "Nom",
  toc: "Sommaire",
  exportMissingPage: "page introuvable",
  exportDownload: "Télécharger",
  exportTooLarge: "(trop volumineux pour être intégré)",
};
const t = (key: Key) => LABELS[key] ?? key;
const text = (value: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: value, styles });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const BLOCKS: ExportBlock[] = [
  { id: "toc1", type: "toc" },
  { id: "h1", type: "heading", props: { level: 1 }, content: [text("Introduction & <but>")] },
  {
    id: "p1",
    type: "paragraph",
    props: { textColor: "red", backgroundColor: "yellow" },
    content: [
      text("Gras", { bold: true }),
      text(" et "),
      { type: "math", props: { latex: "x^2" } },
      text(" voir "),
      { type: "pageLink", props: { pageId: "other" } },
      text(" "),
      { type: "pageLink", props: { pageId: "gone" } },
      text(" "),
      { type: "cite", props: { key: "knuth84" } },
      text(" "),
      { type: "link", href: "https://example.com", content: [text("lien")] },
      { type: "link", href: "javascript:alert(1)", content: [text(" piège")] },
    ],
  },
  { id: "empty", type: "paragraph", content: [] },
  { id: "fffc", type: "paragraph", content: [text("￼")] },
  { id: "b1", type: "bulletListItem", content: [text("un")], children: [] },
  { id: "b2", type: "bulletListItem", content: [] },
  { id: "b3", type: "bulletListItem", content: [text("deux")] },
  { id: "n1", type: "numberedListItem", props: { start: 3 }, content: [text("trois")] },
  { id: "c1", type: "checkListItem", props: { checked: true }, content: [text("fait")] },
  { id: "c2", type: "checkListItem", props: { checked: false }, content: [text("à faire")] },
  {
    id: "tg",
    type: "toggleListItem",
    content: [text("Replié")],
    children: [{ id: "tgc", type: "paragraph", content: [text("caché")] }],
  },
  {
    id: "h2",
    type: "heading",
    props: { level: 2, isToggleable: true },
    content: [text("Section")],
    children: [{ id: "h2c", type: "paragraph", content: [text("dedans")] }],
  },
  { id: "q", type: "quote", content: [text("Citation")] },
  { id: "code", type: "codeBlock", props: { language: "javascript" }, content: [text("const a = 1 < 2;")] },
  { id: "code2", type: "codeBlock", props: { language: "text" }, content: [text("brut <b>")] },
  {
    id: "tbl",
    type: "table",
    content: {
      type: "tableContent",
      headerRows: 1,
      columnWidths: [120, undefined],
      rows: [
        { cells: [{ type: "tableCell", content: [text("A")], props: {} }, [text("B")]] },
        { cells: [{ type: "tableCell", content: [text("1")], props: { backgroundColor: "blue" } }, [text("2")]] },
      ],
    },
  },
  {
    id: "img",
    type: "image",
    props: { url: "nautila-file:img", caption: "Légende", previewWidth: 300, textAlignment: "center" },
  },
  { id: "img2", type: "image", props: { url: "" } },
  { id: "aud", type: "audio", props: { url: "nautila-file:aud", name: "cours.webm" } },
  { id: "note", type: "audioNote", props: { url: "nautila-file:aud" } },
  { id: "file", type: "file", props: { url: "nautila-file:doc", name: "plan.docx" } },
  {
    id: "pdf",
    type: "pdf",
    props: {
      url: "nautila-file:pdf",
      name: "cours.pdf",
      highlights: JSON.stringify([
        { id: "a", page: 4, text: "deuxième", rects: [] },
        { id: "b", page: 2, text: "premier", rects: [] },
      ]),
    },
  },
  {
    id: "sk",
    type: "sketch",
    props: {
      strokes: JSON.stringify([
        { d: "M1 2 L3 4", color: "currentColor" },
        { d: "M5 6 L7 8", color: "#d44c47" },
        { d: '"><script>', color: "#000" },
      ]),
    },
  },
  { id: "m1", type: "mathBlock", props: { latex: "\\int_0^1 x\\,dx", numbered: true } },
  { id: "m2", type: "mathBlock", props: { latex: "a+b", numbered: false } },
  { id: "m3", type: "mathBlock", props: { latex: "e=mc^2", numbered: true } },
  { id: "m4", type: "mathBlock", props: { latex: "" } },
  { id: "fc", type: "flashcard", props: { front: "Capitale ?", back: "Paris" } },
  { id: "co", type: "callout", props: { icon: "⚠️" }, content: [text("Attention")] },
  {
    id: "cols",
    type: "columnList",
    children: [
      {
        id: "col1",
        type: "column",
        props: { width: 1 },
        children: [{ id: "cp1", type: "paragraph", content: [text("gauche")] }],
      },
      {
        id: "col2",
        type: "column",
        props: { width: 2 },
        children: [{ id: "cp2", type: "paragraph", content: [text("droite")] }],
      },
    ],
  },
  { id: "sy", type: "syncedBlock", props: { sourceId: "src" } },
  { id: "db", type: "databaseEmbed", props: { pageId: "base" } },
  { id: "hr", type: "divider" },
  { id: "pb", type: "pageBreak" },
  { id: "bib", type: "bibliography" },
];

function sources(): ExportSources {
  const s = emptySources();
  s.files.set("nautila-file:img", { name: "photo.png", mime: "image/png", data: PNG });
  s.files.set("nautila-file:aud", { name: "cours.webm", mime: "audio/webm", data: "AAAA" });
  s.files.set("nautila-file:doc", { name: "plan.docx", mime: "application/msword", data: "AAAA" });
  s.files.set("nautila-file:pdf", { name: "cours.pdf", mime: "application/pdf", data: "A".repeat(8 * 1024 * 1024) });
  s.files.set("nautila-file:cover", { name: "c.png", mime: "image/png", data: PNG });
  s.pages.set("other", { title: "Autre page", icon: "📘" });
  s.pages.set("base", { title: "Ma base", icon: null });
  s.pages.set("row2", { title: "Ligne liée", icon: null });
  s.refs = [
    { key: "knuth84", author: "Donald E. Knuth", title: "The TeXbook", year: "1984", bibtex: "" },
    { key: "unused", author: "Personne", title: "Rien", year: "2000", bibtex: "" },
  ];
  s.synced.set("src", [
    { id: "sh", type: "heading", props: { level: 3 }, content: [text("Synchronisé")] },
    { id: "sp", type: "paragraph", content: [text("contenu partagé")] },
    { id: "loop", type: "syncedBlock", props: { sourceId: "src" } },
  ]);
  s.databases.set("base", {
    title: "Ma base",
    icon: "🗂️",
    props: [
      { id: "st", name: "Statut", type: "select", options: [{ id: "o1", name: "Fini", color: "green" }] },
      { id: "ok", name: "Validé", type: "checkbox" },
      { id: "rel", name: "Lien", type: "relation" },
    ],
    rows: [
      {
        id: "r1",
        title: "Ligne 1",
        icon: null,
        cover: null,
        props: { st: "o1", ok: true, rel: ["row2"] },
        position: 1,
        created_at: 0,
        updated_at: 0,
      },
    ],
  });
  s.code.set(codeKey("javascript", "const a = 1 < 2;"), [
    [
      { content: "const", color: "#D73A49" },
      { content: " a = 1 < 2;", color: "#24292E" },
    ],
  ]);
  return s;
}

const PAGE: ExportPage = {
  title: `Cours & "révisions" <1>`,
  icon: "🧪",
  tags: ["maths", "a&b"],
  font: "serif",
  small: true,
  wide: false,
  cover: "nautila-file:cover",
};

describe("renderPageHtml", () => {
  const html = renderPageHtml(PAGE, BLOCKS, sources(), t, "fr");

  it("produit un document autonome en thème clair", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<style>");
    expect(html).toContain("color-scheme: light");
    expect(html).toContain("@page");
    expect(html).toContain("@media print");
    expect(html).toContain("break-inside: avoid");
    expect(html).toContain("print-color-adjust: exact");
    expect(html).not.toMatch(/<script|<link /);
  });

  it("échappe le titre et affiche icône, étiquettes, couverture, police", () => {
    expect(html).toContain("<title>Cours &amp; &quot;révisions&quot; &lt;1&gt;</title>");
    expect(html).toContain('<h1 class="title">Cours &amp; &quot;révisions&quot; &lt;1&gt;</h1>');
    expect(html).toContain('<div class="page-icon">🧪</div>');
    expect(html).toContain("#maths");
    expect(html).toContain("#a&amp;b");
    expect(html).toContain(`<div class="cover"><img src="data:image/png;base64,${PNG}"`);
    expect(html).toContain("Georgia");
    expect(html).toMatch(/class="page small has-cover"/);
  });

  it("n'exporte ni adresse interne ni caractère parasite", () => {
    expect(html).not.toContain("nautila-file:");
    expect(html).not.toContain("￼");
    expect(html).not.toContain("#/page/");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
  });

  it("rend les formules en MathML, numérotées dans l'ordre", () => {
    expect(html).toContain("<math");
    expect(html).toContain('display="block"');
    expect(html).toContain('<span class="eq-number">(1)</span>');
    expect(html).toContain('<span class="eq-number">(2)</span>');
    expect(html).not.toContain('<span class="eq-number">(3)</span>');
    expect(html).not.toContain("<code>$");
  });

  it("intègre images et audio en data:, et décrit les fichiers joints", () => {
    expect(html).toContain(`<img src="data:image/png;base64,${PNG}" alt="Légende" style="width:300px">`);
    expect(html).toContain("<figcaption>Légende</figcaption>");
    expect(html).toContain('<audio controls preload="metadata" src="data:audio/webm;base64,AAAA">');
    expect(html).toContain("Enregistrement audio");
    expect(html).toContain('href="data:application/msword;base64,AAAA" download="plan.docx"');
    // PDF trop volumineux : nom et surlignages, sans lien intégré.
    expect(html).toContain("📄 cours.pdf");
    expect(html).not.toContain("data:application/pdf");
    expect(html).toContain(t("exportTooLarge"));
    expect(html.indexOf("premier")).toBeLessThan(html.indexOf("deuxième"));
    expect(html).toContain('<span class="pdf-page">p. 2</span>');
  });

  it("génère le sommaire avec des ancres vers les titres", () => {
    expect(html).toContain('<nav class="toc"');
    expect(html).toContain(`href="#${anchorId("h1")}"`);
    expect(html).toContain(`<h2 id="${anchorId("h1")}" class="h1">Introduction &amp; &lt;but&gt;</h2>`);
    expect(html).toContain(`href="#${anchorId("sh")}"`);
    expect(html.indexOf('<nav class="toc"')).toBeLessThan(html.indexOf(`id="${anchorId("h1")}"`));
  });

  it("résout citations, bibliographie et liens entre pages", () => {
    expect(html).toContain("(Knuth, 1984)");
    expect(html).toContain("Donald E. Knuth (1984). <em>The TeXbook</em>.");
    expect(html).not.toContain("Personne");
    expect(html).toContain('<span class="page-ref">📘 Autre page</span>');
    expect(html).toContain(t("exportMissingPage"));
    expect(html).toContain('<a href="https://example.com">lien</a>');
  });

  it("garde couleurs, listes, cases, blocs repliables ouverts, tableaux", () => {
    expect(html).toContain('style="color:#e03e3e;background:#fbf3db');
    expect(html).toContain("<strong>Gras</strong>");
    expect(html).toContain("<ul><li>un</li><li>deux</li></ul>");
    expect(html).toContain('<ol start="3"><li>trois</li></ol>');
    expect(html).toContain('<ul class="checklist"><li class="done"><span class="check on">✓</span>');
    expect(html).toContain('<details open class="toggle"><summary>Replié</summary>');
    expect(html).toContain('<details open class="toggle"><summary><h3');
    expect(html).toContain("<thead><tr><th>A</th><th>B</th></tr></thead>");
    expect(html).toContain('<td style="background:#ddebf1');
    expect(html).toContain('<col style="width:120px">');
  });

  it("colore le code et échappe le code brut", () => {
    expect(html).toContain('<span style="color:#D73A49">const</span>');
    expect(html).toContain("a = 1 &lt; 2;");
    expect(html).toContain("brut &lt;b&gt;");
  });

  it("rend les blocs propres à Nautila", () => {
    expect(html).toContain('<span class="fc-label">Question</span><div>Capitale ?</div>');
    expect(html).toContain('<span class="fc-label">Réponse</span><div>Paris</div>');
    expect(html).toContain('<div class="callout"><span class="callout-icon">⚠️</span>');
    expect(html).toContain('<div class="columns"><div class="column" style="flex:1 1 0">');
    expect(html).toContain('style="flex:2 1 0"');
    expect(html).toContain("contenu partagé");
    expect(html.match(/contenu partagé/g)).toHaveLength(1);
    expect(html).toContain('stroke="#000000"');
    expect(html).toContain('stroke="#d44c47"');
    expect(html).toContain('width="800" height="360"');
    expect(html).not.toContain("currentColor");
    expect(html).toContain('<div class="db-title">🗂️ Ma base</div>');
    expect(html).toContain('<span class="tag tag-green">Fini</span>');
    expect(html).toContain("<td>Ligne liée</td>");
    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain("<hr>");
  });

  it("ignore les blocs vides", () => {
    const body = renderBlocksHtml(
      [
        { id: "a", type: "paragraph", content: [] },
        { id: "b", type: "bulletListItem", content: [text("")] },
        { id: "c", type: "heading", props: { level: 2 }, content: [] },
        { id: "d", type: "image", props: { url: "" } },
        { id: "e", type: "toc" },
        { id: "f", type: "bibliography" },
        { id: "g", type: "sketch", props: { strokes: "[]" } },
        { id: "h", type: "codeBlock", props: { language: "text" }, content: [] },
      ],
      emptySources(),
      t,
    );
    expect(body).toBe("");
  });
});

describe("collectNeeds", () => {
  it("relève fichiers, blocs synchronisés, bases et code à colorer", () => {
    const s = sources();
    const needs = collectNeeds(BLOCKS, s);
    expect([...needs.files].sort()).toEqual([
      "nautila-file:aud",
      "nautila-file:doc",
      "nautila-file:img",
      "nautila-file:pdf",
    ]);
    expect([...needs.synced]).toEqual(["src"]);
    expect([...needs.databases]).toEqual(["base"]);
    expect(needs.code).toEqual([{ language: "javascript", code: "const a = 1 < 2;" }]);
  });

  it("descend dans le contenu des blocs synchronisés connus", () => {
    const s = emptySources();
    s.synced.set("x", [{ id: "i", type: "image", props: { url: "nautila-file:inner" } }]);
    const needs = collectNeeds([{ id: "s", type: "syncedBlock", props: { sourceId: "x" } }], s);
    expect([...needs.files]).toEqual(["nautila-file:inner"]);
  });
});

describe("escapeHtml", () => {
  it("échappe en entités et retire U+FFFC", () => {
    expect(escapeHtml(`<a href="x">&'￼`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
