import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";

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
  { type: "mathBlock", propSchema: { latex: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const latex = block.props.latex;
      const [editing, setEditing] = useState(latex === "" && editor.isEditable);
      return (
        <div className="math-block" contentEditable={false}>
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

export const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, mathBlock: MathBlock(), flashcard: Flashcard() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, math: InlineMath, pageLink: PageLink },
});

export type NautilaEditor = typeof schema.BlockNoteEditor;
export type NautilaBlock = typeof schema.PartialBlock;
