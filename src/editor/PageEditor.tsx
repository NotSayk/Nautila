import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { syntaxHighlighter } from "@blocknote/code-block";
import { en, fr } from "@blocknote/core/locales";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import {
  getMultiColumnSlashMenuItems,
  locales as columnLocales,
  multiColumnDropCursor,
} from "@blocknote/xl-multi-column";
import { FileText, Layers, ListTree, MessageSquareQuote, Sigma } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as Y from "yjs";
import { extract } from "../data/extract";
import { resolveFileUrl, saveFile } from "../data/files";
import { savePageContent } from "../data/pages";
import { pendingMarkdown } from "../data/templates";
import { useT } from "../i18n";
import { useStore } from "../store";
import { languageId, schema, type NautilaBlock, type NautilaEditor } from "./schema";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Ramène les langages de code inconnus à du texte brut : le colorateur refuse les autres. */
function knownLanguages<T extends { type: string; props?: any; children?: T[] }>(blocks: T[]): T[] {
  return blocks.map((b) => ({
    ...b,
    props: b.type === "codeBlock" ? { ...b.props, language: languageId(b.props?.language ?? "") } : b.props,
    children: b.children ? knownLanguages(b.children) : b.children,
  }));
}

export type PageEditorHandle = {
  toMarkdown: () => string;
  applyTemplate: (blocks: NautilaBlock[]) => void;
  wordCount: () => number;
  toHTML: () => string;
  /** Texte brut de la page. */
  bodyText: () => string;
  /** État Yjs courant, en base64. */
  docState: () => string;
};

type Props = {
  pageId: string;
  /** État Yjs enregistré (base64), ou null pour une page neuve. */
  initialDoc: string | null;
  editable?: boolean;
  /** Réindexe le contenu dès l'ouverture (après une restauration ou un modèle). */
  saveOnMount?: boolean;
  /** Appelé à la première modification du contenu. */
  onFirstEdit?: () => void;
};

export const PageEditor = forwardRef<PageEditorHandle, Props>(function PageEditor(
  { pageId, initialDoc, editable = true, saveOnMount, onFirstEdit },
  ref,
) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const dark = useStore((s) => s.dark);
  const pages = useStore((s) => s.pages);

  const doc = useMemo(() => {
    const d = new Y.Doc();
    if (initialDoc) Y.applyUpdate(d, fromBase64(initialDoc));
    return d;
  }, [initialDoc]);

  const editor: NautilaEditor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary: {
        ...(lang === "fr" ? fr : en),
        multi_column: columnLocales[lang],
      },
      extensions: [syntaxHighlighter],
      dropCursor: multiColumnDropCursor,
      uploadFile: async (file: File) => {
        try {
          return await saveFile(file);
        } catch (err) {
          alert(t("fileTooLarge"));
          throw err;
        }
      },
      resolveFileUrl,
      collaboration: {
        fragment: doc.getXmlFragment("doc"),
        user: { name: "local", color: "#2383e2" },
      },
    }),
    [doc, lang],
  );

  useImperativeHandle(
    ref,
    () => ({
      toMarkdown: () => editor.blocksToMarkdownLossy(),
      applyTemplate: (blocks) => void editor.replaceBlocks(editor.document, blocks),
      toHTML: () => editor.blocksToHTMLLossy(),
      bodyText: () => extract(editor.document as never).body,
      docState: () => toBase64(Y.encodeStateAsUpdate(doc)),
      wordCount: () =>
        extract(editor.document as never)
          .body.split(/\s+/)
          .filter(Boolean).length,
    }),
    [editor, doc],
  );

  // Enregistrement différé à chaque modification, et immédiat quand on quitte.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const onFirstEditRef = useRef(onFirstEdit);
  onFirstEditRef.current = onFirstEdit;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = async () => {
      clearTimeout(timer);
      timer = undefined;
      await savePageContent(pageId, toBase64(Y.encodeStateAsUpdate(doc)), extract(editorRef.current.document as never));
      void useStore.getState().refreshDue();
    };
    const flush = () => timer && void save();
    let edited = false;
    const onUpdate = () => {
      if (!edited) onFirstEditRef.current?.();
      edited = true;
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();

    doc.on("update", onUpdate);
    const markdown = pendingMarkdown.get(pageId);
    if (markdown !== undefined) {
      pendingMarkdown.delete(pageId);
      const current = editorRef.current;
      current.replaceBlocks(current.document, knownLanguages(current.tryParseMarkdownToBlocks(markdown)));
    } else if (saveOnMount) void save();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      doc.off("update", onUpdate);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [doc, pageId]);

  const studyItems = (): DefaultReactSuggestionItem[] => [
    {
      title: t("mathBlock"),
      subtext: t("mathBlockSub"),
      aliases: ["latex", "math", "equation", "formule", "katex"],
      group: t("groupStudy"),
      icon: <Sigma size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "mathBlock" }),
    },
    {
      title: t("mathInline"),
      subtext: t("mathInlineSub"),
      aliases: ["latex", "math", "inline", "formule"],
      group: t("groupStudy"),
      icon: <Sigma size={18} />,
      onItemClick: () => editor.insertInlineContent([{ type: "math", props: { latex: "" } }, " "]),
    },
    {
      title: t("flashcard"),
      subtext: t("flashcardSub"),
      aliases: ["card", "carte", "anki", "question", "revision"],
      group: t("groupStudy"),
      icon: <Layers size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "flashcard" }),
    },
  ];

  const layoutItems = (): DefaultReactSuggestionItem[] => [
    {
      title: t("callout"),
      subtext: t("calloutSub"),
      aliases: ["callout", "encadre", "note", "info", "attention"],
      group: t("groupLayout"),
      icon: <MessageSquareQuote size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "callout" }),
    },
    {
      title: t("toc"),
      subtext: t("tocSub"),
      aliases: ["toc", "sommaire", "table", "contents", "plan"],
      group: t("groupLayout"),
      icon: <ListTree size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "toc" }),
    },
    ...getMultiColumnSlashMenuItems(editor).map((item) => ({
      ...item,
      group: t("groupLayout"),
    })),
  ];

  const pageItems = (): DefaultReactSuggestionItem[] =>
    pages
      .filter((p) => p.id !== pageId)
      .map((p) => ({
        title: p.title || t("untitled"),
        group: t("linkPage"),
        icon: p.icon ? <span>{p.icon}</span> : <FileText size={18} />,
        onItemClick: () => editor.insertInlineContent([{ type: "pageLink", props: { pageId: p.id } }, " "]),
      }));

  // Cliquer sous le dernier bloc place le curseur à la fin, en ajoutant une
  // ligne vide si la page se termine par un bloc non textuel (code, image…).
  const focusEnd = () => {
    const last = editor.document[editor.document.length - 1];
    const empty = last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
    const target = empty ? last : editor.insertBlocks([{ type: "paragraph" }], last, "after")[0];
    editor.setTextCursorPosition(target, "end");
    editor.focus();
  };

  return (
    <>
      <BlockNoteView editor={editor} editable={editable} theme={dark ? "dark" : "light"} slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...layoutItems(), ...studyItems()], query)
          }
        />
        <SuggestionMenuController
          triggerCharacter="@"
          getItems={async (query) => filterSuggestionItems(pageItems(), query).slice(0, 12)}
        />
      </BlockNoteView>
      {editable && <div className="h-[24vh] cursor-text" onClick={focusEnd} />}
    </>
  );
});
