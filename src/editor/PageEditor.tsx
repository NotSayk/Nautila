import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
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
import { FileText, Layers, Sigma } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as Y from "yjs";
import { extract } from "../data/extract";
import { savePageContent } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { schema, type NautilaBlock, type NautilaEditor } from "./schema";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export type PageEditorHandle = { toMarkdown: () => string; applyTemplate: (blocks: NautilaBlock[]) => void };

type Props = {
  pageId: string;
  /** État Yjs enregistré (base64), ou null pour une page neuve. */
  initialDoc: string | null;
  /** Appelé à la première modification du contenu. */
  onFirstEdit?: () => void;
};

export const PageEditor = forwardRef<PageEditorHandle, Props>(function PageEditor(
  { pageId, initialDoc, onFirstEdit },
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
      dictionary: lang === "fr" ? fr : en,
      collaboration: { fragment: doc.getXmlFragment("doc"), user: { name: "local", color: "#2383e2" } },
    }),
    [doc, lang],
  );

  useImperativeHandle(
    ref,
    () => ({
      toMarkdown: () => editor.blocksToMarkdownLossy(),
      applyTemplate: (blocks) => void editor.replaceBlocks(editor.document, blocks),
    }),
    [editor],
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

  const pageItems = (): DefaultReactSuggestionItem[] =>
    pages
      .filter((p) => p.id !== pageId)
      .map((p) => ({
        title: p.title || t("untitled"),
        group: t("linkPage"),
        icon: p.icon ? <span>{p.icon}</span> : <FileText size={18} />,
        onItemClick: () => editor.insertInlineContent([{ type: "pageLink", props: { pageId: p.id } }, " "]),
      }));

  return (
    <BlockNoteView editor={editor} theme={dark ? "dark" : "light"} slashMenu={false}>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...studyItems()], query)
        }
      />
      <SuggestionMenuController
        triggerCharacter="@"
        getItems={async (query) => filterSuggestionItems(pageItems(), query).slice(0, 12)}
      />
    </BlockNoteView>
  );
});
