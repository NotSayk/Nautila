import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { codeBlockOptions } from "./highlight";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { EmojiPicker } from "../views/EmojiPicker";
import { DatabaseView } from "../views/database/DatabaseView";
import { Bibliography, Cite, SyncedBlock } from "./extras";
import { AudioNote, PdfBlock, Sketch } from "./media";

function renderLatex(latex: string, displayMode: boolean) {
  return katex.renderToString(latex, { displayMode, throwOnError: false });
}

/** Zone de texte qui grandit avec son contenu. */
function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

const MathBlock = createReactBlockSpec(
  { type: "mathBlock", propSchema: { latex: { default: "" }, numbered: { default: false } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const latex = block.props.latex;
      const [editing, setEditing] = useState(latex === "" && editor.isEditable);
      return (
        <div className="math-block" data-numbered={block.props.numbered || undefined} contentEditable={false}>
          {editor.isEditable && (
            <button
              className="math-number-toggle"
              title={t("numberEquation")}
              aria-label={t("numberEquation")}
              aria-pressed={block.props.numbered}
              onClick={() => editor.updateBlock(block, { props: { numbered: !block.props.numbered } })}
            >
              (n)
            </button>
          )}
          <div
            className="math-block-preview"
            onClick={() => editor.isEditable && setEditing(true)}
            {...(latex
              ? { dangerouslySetInnerHTML: { __html: renderLatex(latex, true) } }
              : { children: <span className="math-empty">{t("emptyFormula")}</span> })}
          />
          {editing && (
            <AutoTextarea
              autoFocus
              className="math-source"
              spellCheck={false}
              placeholder="\int_0^1 x^2 \, dx"
              value={latex}
              onChange={(e) => editor.updateBlock(block, { props: { latex: e.target.value } })}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            />
          )}
        </div>
      );
    },
    // Export (Markdown, copier-coller) : un bloc de code garde le LaTeX intact.
    toExternalHTML: ({ block }) => (
      <pre>
        <code className="language-latex">{block.props.latex}</code>
      </pre>
    ),
  },
);

const Flashcard = createReactBlockSpec(
  { type: "flashcard", propSchema: { front: { default: "" }, back: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const field = (name: "front" | "back", label: string) => (
        <label className="flashcard-field">
          <span>{label}</span>
          <AutoTextarea
            value={block.props[name]}
            readOnly={!editor.isEditable}
            onChange={(e) => editor.updateBlock(block, { props: { [name]: e.target.value } })}
          />
        </label>
      );
      return (
        <div className="flashcard" contentEditable={false}>
          {field("front", t("question"))}
          {field("back", t("answer"))}
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <blockquote>
        <p>
          <strong>Q :</strong> {block.props.front}
        </p>
        <p>
          <strong>R :</strong> {block.props.back}
        </p>
      </blockquote>
    ),
  },
);

const InlineMath = createReactInlineContentSpec(
  { type: "math", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent, updateInlineContent, editor }) => {
      const latex = inlineContent.props.latex;
      const [editing, setEditing] = useState(latex === "" && editor.isEditable);
      return (
        <span className="math-inline" contentEditable={false}>
          <span
            onClick={() => editor.isEditable && setEditing(true)}
            dangerouslySetInnerHTML={{ __html: renderLatex(latex || "\\square", false) }}
          />
          {editing && (
            <input
              autoFocus
              className="math-inline-source"
              spellCheck={false}
              placeholder="x^2"
              value={latex}
              onChange={(e) => updateInlineContent({ type: "math", props: { latex: e.target.value } })}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => (e.key === "Escape" || e.key === "Enter") && e.currentTarget.blur()}
            />
          )}
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => <code>${inlineContent.props.latex}$</code>,
  },
);

const PageLink = createReactInlineContentSpec(
  { type: "pageLink", propSchema: { pageId: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent }) => {
      const t = useT();
      const id = inlineContent.props.pageId;
      const page = useStore((s) => s.pages.find((p) => p.id === id));
      const navigate = useStore((s) => s.navigate);
      return (
        <span
          className={`page-link${page ? "" : " page-link-missing"}`}
          contentEditable={false}
          onClick={() => page && navigate({ view: "page", id })}
        >
          {page?.icon ?? <FileText size={14} />}
          {page ? page.title || t("untitled") : t("pageMissing")}
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => {
      const id = inlineContent.props.pageId;
      const title = useStore.getState().pages.find((p) => p.id === id)?.title;
      return <a href={`#/page/${id}`}>{title || id}</a>;
    },
  },
);

/** Identifiant d'un langage de code connu (alias compris), sinon texte brut. */
export function languageId(name: string): string {
  const wanted = name.trim().toLowerCase();
  for (const [id, lang] of Object.entries(codeBlockOptions.supportedLanguages))
    if (id === wanted || lang.aliases?.some((a) => a === wanted)) return id;
  return "text";
}

// Un bloc de code collé ou importé peut porter un alias (« js ») ou un langage
// inconnu, que le rendu d'origine refuse en levant une erreur : on le normalise.
const codeBlock = createCodeBlockSpec(codeBlockOptions);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderCode = codeBlock.implementation.render as (this: unknown, block: any, editor: any) => any;
codeBlock.implementation.render = function (block, editor) {
  const language = languageId(block.props.language);
  const fixed = language === block.props.language ? block : { ...block, props: { ...block.props, language } };
  return renderCode.call(this, fixed, editor);
};

const Callout = createReactBlockSpec(
  { type: "callout", propSchema: { icon: { default: "💡" } }, content: "inline" },
  {
    render: ({ block, editor, contentRef }) => {
      const [anchor, setAnchor] = useState<DOMRect | null>(null);
      return (
        <div className="callout">
          <button
            contentEditable={false}
            className="callout-icon"
            onClick={(e) => editor.isEditable && setAnchor(e.currentTarget.getBoundingClientRect())}
          >
            {block.props.icon}
          </button>
          {anchor && (
            <EmojiPicker
              anchor={anchor}
              onClose={() => setAnchor(null)}
              onPick={(icon) => editor.updateBlock(block, { props: { icon } })}
            />
          )}
          <div className="callout-text" ref={contentRef} />
        </div>
      );
    },
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote>
        <p>
          {block.props.icon} <span ref={contentRef} />
        </p>
      </blockquote>
    ),
  },
);

type Heading = { id: string; level: number; text: string };

function collectHeadings(blocks: any[], out: Heading[] = []): Heading[] {
  for (const b of blocks) {
    if (b.type === "heading" && Array.isArray(b.content)) {
      const text = b.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
      if (text.trim()) out.push({ id: b.id, level: b.props.level, text });
    }
    if (b.children?.length) collectHeadings(b.children, out);
  }
  return out;
}

const TableOfContents = createReactBlockSpec(
  { type: "toc", propSchema: {}, content: "none" },
  {
    render: ({ editor }) => {
      const t = useT();
      const [headings, setHeadings] = useState<Heading[]>(() => collectHeadings(editor.document));
      useEffect(() => {
        const refresh = () => setHeadings(collectHeadings(editor.document));
        refresh();
        return editor.onChange(refresh);
      }, [editor]);
      // Le niveau le plus haut présent n'est pas indenté (même s'il n'y a que des titres de niveau 4, 5…).
      const top = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;
      return (
        <nav className="toc" contentEditable={false}>
          {headings.length === 0 && <span className="math-empty">{t("tocEmpty")}</span>}
          {headings.map((h) => (
            <button
              key={h.id}
              style={{ paddingLeft: 6 + (h.level - top) * 20 }}
              onClick={() =>
                document
                  .querySelector(`[data-id="${CSS.escape(h.id)}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {h.text}
            </button>
          ))}
        </nav>
      );
    },
    toExternalHTML: () => <p />,
  },
);

/** Base de données affichée dans une page ; elle reste une page à part entière. */
const DatabaseEmbed = createReactBlockSpec(
  { type: "databaseEmbed", propSchema: { pageId: { default: "" } }, content: "none" },
  {
    render: ({ block }) => {
      const t = useT();
      const page = useStore((s) => s.pages.find((p) => p.id === block.props.pageId));
      const navigate = useStore((s) => s.navigate);
      if (!page) return <p className="math-empty">{t("pageMissing")}</p>;
      return (
        <div className="media-block" contentEditable={false}>
          <button className="db-embed-title" onClick={() => navigate({ view: "page", id: page.id })}>
            {page.icon} {page.title || t("untitled")}
          </button>
          <DatabaseView page={page} embedded />
        </div>
      );
    },
    toExternalHTML: ({ block }) => <p>{useStore.getState().pages.find((p) => p.id === block.props.pageId)?.title}</p>,
  },
);

export const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock,
      mathBlock: MathBlock(),
      flashcard: Flashcard(),
      callout: Callout(),
      toc: TableOfContents(),
      audioNote: AudioNote(),
      pdf: PdfBlock(),
      sketch: Sketch(),
      databaseEmbed: DatabaseEmbed(),
      bibliography: Bibliography(),
      syncedBlock: SyncedBlock(),
    },
    inlineContentSpecs: { ...defaultInlineContentSpecs, math: InlineMath, pageLink: PageLink, cite: Cite },
  }),
);

export type NautilaEditor = typeof schema.BlockNoteEditor;
export type NautilaBlock = typeof schema.PartialBlock;
