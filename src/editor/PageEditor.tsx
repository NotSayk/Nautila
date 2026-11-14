import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { syntaxHighlighter } from "./highlight";
import { en, fr } from "@blocknote/core/locales";
import { withCollaboration, yDocToBlocks } from "@blocknote/core/yjs";
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
import {
  FileText,
  Layers,
  ListTree,
  Mic,
  PenLine,
  MessageSquareQuote,
  LibraryBig,
  Quote,
  RefreshCw,
  Sigma,
  Table2,
} from "lucide-react";
import { forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { countWords, extract, type Extracted } from "../data/extract";
import { Comments } from "./Comments";
import { askCitePicker, SyncChain } from "./extras";
import { shrinkImage } from "./image";
import { mathInput } from "./mathInput";
import { lastTextBlock } from "./parse";
import { resolveFileUrl, saveFile, watchSharedFiles } from "../data/files";
import { createPage, savePageContent } from "../data/pages";
import { PAGE_LINK } from "../data/importer";
import { pendingBlocks, pendingHtml, pendingMarkdown } from "../data/templates";
import { useT } from "../i18n";
import { useStore } from "../store";
import { REMOTE_DOC_EVENT } from "../sync/engine";
import { knownRole, startShareSession, type ShareRole } from "../sync/share";
import { fromBase64, toBase64 } from "../util/base64";
import { notify } from "../views/dialogs";
import { languageId, schema, type NautilaBlock, type NautilaEditor } from "./schema";

/**
 * Met un contenu importé aux normes de l'éditeur : les langages de code inconnus deviennent
 * du texte brut (le colorateur refuse les autres), et les liens vers une page importée
 * deviennent des mentions de page.
 */
function knownLanguages<T extends { type: string; props?: any; content?: any; children?: T[] }>(blocks: T[]): T[] {
  return blocks.map((b) => ({
    ...b,
    props: b.type === "codeBlock" ? { ...b.props, language: languageId(b.props?.language ?? "") } : b.props,
    content: Array.isArray(b.content)
      ? b.content.map((item: any) =>
          item?.type === "link" && typeof item.href === "string" && item.href.startsWith(PAGE_LINK)
            ? { type: "pageLink", props: { pageId: item.href.slice(PAGE_LINK.length) } }
            : item,
        )
      : b.content,
    children: b.children ? knownLanguages(b.children) : b.children,
  }));
}

/** Origine des modifications reçues d'un autre exemplaire du même contenu. */
const LOCAL_ECHO = "local-echo";

const CURSOR_COLORS = ["#2383e2", "#d44c47", "#448361", "#9065b0", "#d9730d", "#c14c8a", "#0b6e99"];
/** Couleur de curseur stable pour un identifiant donné. */
function userColor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

/**
 * Libération d'un document et de sa présence (le second lance un minuteur). Différée : le même document
 * peut être remonté aussitôt (double montage de React en développement), et l'enregistrement de sortie
 * doit pouvoir finir.
 */
const pendingDestroy = new WeakMap<Y.Doc, ReturnType<typeof setTimeout>>();
function releaseDoc(doc: Y.Doc, awareness: Awareness) {
  pendingDestroy.set(
    doc,
    setTimeout(() => {
      try {
        awareness.destroy();
        doc.destroy();
      } catch {
        /* déjà détruits */
      }
    }, 1000),
  );
}

export type PageEditorHandle = {
  /** Markdown du contenu, ou des blocs donnés (préparés pour l'export). */
  toMarkdown: (blocks?: unknown[]) => string;
  applyTemplate: (blocks: NautilaBlock[]) => void;
  wordCount: () => number;
  /** Blocs du contenu, pour l'export. */
  blocks: () => unknown[];
  /** Blocs d'un autre contenu Yjs enregistré (base64), lus avec le même schéma. */
  readDoc: (ydoc: string) => unknown[];
  /** Place le curseur au début du contenu. */
  focus: () => void;
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
  /** Page partagée en direct : identifiant de la salle, et retour d'état pour l'en-tête. */
  shareId?: string | null;
  onShareState?: (state: { online: boolean; peers: number; role: ShareRole }) => void;
  /** Intégré dans un autre contenu (bloc synchronisé) : sans marge ni zone de clic en bas. */
  embedded?: boolean;
  /** Affichage seul d'un contenu qui n'appartient pas à cet appareil : rien n'est enregistré. */
  ephemeral?: boolean;
  /** Remplace la résolution des fichiers joints (page publique). */
  fileResolver?: (url: string) => Promise<string>;
  /** Panneau des commentaires ouvert, et retour du nombre de commentaires non résolus. */
  commentsOpen?: boolean;
  onCommentCount?: (count: number) => void;
  onCloseComments?: () => void;
  /** Appelé à la première modification du contenu. */
  onFirstEdit?: () => void;
};

export const PageEditor = forwardRef<PageEditorHandle, Props>(function PageEditor(
  {
    pageId,
    initialDoc,
    editable = true,
    saveOnMount,
    shareId,
    onShareState,
    embedded,
    ephemeral,
    fileResolver,
    commentsOpen,
    onCommentCount,
    onCloseComments,
    onFirstEdit,
  },
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
  const awareness = useMemo(() => new Awareness(doc), [doc]);
  useEffect(() => {
    clearTimeout(pendingDestroy.get(doc));
    return () => releaseDoc(doc, awareness);
  }, [doc, awareness]);
  const username = useStore((s) => s.sync.username);
  const initialName = useRef(username);
  initialName.current = username;
  const chain = useContext(SyncChain);
  const syncChain = useMemo(() => [...chain, pageId], [chain, pageId]);
  const connected = useStore((s) => s.sync.status !== "off");

  // Fichiers de la page partagée ajoutés par les autres participants : demandés au serveur.
  // (Inscrit pendant le rendu, pour que les blocs puissent les demander dès leur affichage.)
  const sharedFiles = useMemo(() => (shareId ? watchSharedFiles(shareId) : null), [shareId]);
  useEffect(() => () => sharedFiles?.(), [sharedFiles]);

  // Session en direct : ouverte tant que la page partagée est affichée et le compte connecté.
  const shareStateRef = useRef(onShareState);
  shareStateRef.current = onShareState;
  useEffect(() => {
    if (!shareId || !connected) return;
    const state: { online: boolean; peers: number; role: ShareRole } = {
      online: false,
      peers: 0,
      role: knownRole(shareId),
    };
    const report = (patch: Partial<typeof state>) => shareStateRef.current?.({ ...Object.assign(state, patch) });
    const stop = startShareSession(shareId, doc, awareness, {
      onPeers: (peers) => report({ peers }),
      onState: (online) => report({ online }),
      onRole: (role) => report({ role }),
    });
    return () => {
      stop();
      shareStateRef.current?.({ online: false, peers: 0, role: state.role });
    };
  }, [shareId, connected, doc, awareness]);

  const editor: NautilaEditor = useCreateBlockNote(
    withCollaboration({
      schema,
      domAttributes: { editor: { "aria-label": t("editorLabel") } },
      dictionary: {
        ...(lang === "fr" ? fr : en),
        multi_column: columnLocales[lang],
      },
      extensions: [syntaxHighlighter, mathInput],
      dropCursor: multiColumnDropCursor,
      uploadFile: async (file: File) => {
        try {
          // Les très grandes images sont réduites avant d'être gardées dans la base.
          return await saveFile(await shrinkImage(file));
        } catch (err) {
          notify(t("fileTooLarge"));
          throw err;
        }
      },
      resolveFileUrl: fileResolver ?? resolveFileUrl,
      collaboration: {
        fragment: doc.getXmlFragment("doc"),
        // Le nom est mis à jour plus bas, sans recréer l'éditeur (ce qui ferait perdre le curseur).
        user: { name: initialName.current ?? "…", color: userColor(initialName.current ?? "") },
        provider: { awareness },
      },
    }),
    [doc, lang, awareness],
  );
  useEffect(() => {
    awareness.setLocalStateField("user", { name: username ?? "…", color: userColor(username ?? "") });
  }, [awareness, username]);

  useImperativeHandle(
    ref,
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toMarkdown: (blocks) => editor.blocksToMarkdownLossy(blocks as any),
      applyTemplate: (blocks) => void editor.replaceBlocks(editor.document, blocks),
      blocks: () => editor.document,
      readDoc: (ydoc) => {
        const other = new Y.Doc();
        Y.applyUpdate(other, fromBase64(ydoc));
        return yDocToBlocks(editor, other, "doc");
      },
      focus: () => {
        editor.setTextCursorPosition(editor.document[0], "start");
        editor.focus();
      },
      bodyText: () => extract(editor.document as never).body,
      docState: () => toBase64(Y.encodeStateAsUpdate(doc)),
      wordCount: () => countWords(editor.document as never),
    }),
    [editor, doc],
  );

  // Enregistrement différé à chaque modification, et immédiat quand on quitte.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const onFirstEditRef = useRef(onFirstEdit);
  onFirstEditRef.current = onFirstEdit;
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    const instance = {};
    // `timer` sert au délai d'enregistrement comme aux nouveaux essais ; `dirty` : du contenu n'est pas encore gardé.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let running = false;
    let again = false;
    let failures = 0;
    let disposed = false;
    let lastExtracted: Extracted | undefined;
    const save = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (ephemeral || !dirty) return;
      // Un enregistrement est déjà en cours : il recommencera quand il aura fini.
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          dirty = false;
          try {
            // Le contenu est relu à chaque essai ; après la fermeture de l'éditeur, le dernier relevé sert.
            if (!disposed || !lastExtracted) lastExtracted = extract(editorRef.current.document as never);
            // (pendant la fermeture, `disposed` n'est pas encore posé : le relevé est refait à jour)
            await savePageContent(pageId, toBase64(Y.encodeStateAsUpdate(doc)), lastExtracted);
            failures = 0;
          } catch (err) {
            // La modification n'est jamais abandonnée : nouvel essai avec un délai croissant (1 s, 2 s, 4 s… 30 s max).
            console.error("Enregistrement de la page impossible", err);
            dirty = true;
            failures++;
            if (failures === 1 || failures % 5 === 0)
              useStore.setState({ toast: { message: tRef.current("saveRetry") } });
            if (!disposed || failures < 10) timer = setTimeout(save, Math.min(30_000, 1000 * 2 ** (failures - 1)));
            return;
          }
        } while (again);
        void useStore.getState().refreshDue();
      } finally {
        running = false;
      }
    };
    const flush = () => (timer || dirty) && void save();
    let edited = false;
    // Empreinte du contenu sans les identifiants de blocs : sert à ignorer les écritures d'initialisation.
    const signature = () => JSON.stringify(editorRef.current.document, (k, v) => (k === "id" ? undefined : v));
    let baseline: string | undefined;
    try {
      baseline = signature();
    } catch {
      /* éditeur pas encore prêt : toute écriture comptera comme une modification */
    }
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      const remote = origin === LOCAL_ECHO;
      if (!edited && !remote) {
        // L'ouverture de la page peut écrire dans le document (normalisation) sans rien changer au contenu.
        let same = false;
        try {
          same = baseline !== undefined && signature() === baseline;
        } catch {
          /* contenu illisible : on le tient pour modifié */
        }
        if (same) return;
        onFirstEditRef.current?.();
        edited = true;
      }
      // Le même contenu peut être affiché deux fois (bloc synchronisé) : les autres exemplaires
      // reçoivent la modification tout de suite, sans attendre l'enregistrement.
      if (!remote)
        window.dispatchEvent(
          new CustomEvent(REMOTE_DOC_EVENT, { detail: { id: pageId, ydoc: toBase64(update), from: instance } }),
        );
      // Une modification distante est enregistrée ici aussi, mais n'est pas une « première modification ».
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(save, 600);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();

    // Modifications de la même page arrivées d'un autre appareil : fusion en direct.
    const onRemote = (e: Event) => {
      const { id, ydoc, from } = (e as CustomEvent<{ id: string; ydoc: string; from?: object }>).detail;
      if (id === pageId && from !== instance) Y.applyUpdate(doc, fromBase64(ydoc), LOCAL_ECHO);
    };
    window.addEventListener(REMOTE_DOC_EVENT, onRemote);
    doc.on("update", onUpdate);
    const markdown = pendingMarkdown.get(pageId);
    const html = pendingHtml.get(pageId);
    const blocks = pendingBlocks.get(pageId);
    if (blocks !== undefined) {
      pendingBlocks.delete(pageId);
      const current = editorRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      current.replaceBlocks(current.document, blocks as any);
    } else if (html !== undefined) {
      pendingHtml.delete(pageId);
      const current = editorRef.current;
      current.replaceBlocks(current.document, knownLanguages(current.tryParseHTMLToBlocks(html)));
    } else if (markdown !== undefined) {
      pendingMarkdown.delete(pageId);
      const current = editorRef.current;
      current.replaceBlocks(current.document, knownLanguages(current.tryParseMarkdownToBlocks(markdown)));
    } else if (saveOnMount) {
      dirty = true;
      void save();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      doc.off("update", onUpdate);
      window.removeEventListener(REMOTE_DOC_EVENT, onRemote);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      // Dernier relevé du texte, tant que l'éditeur existe : les éventuels nouveaux essais s'en serviront.
      try {
        if (dirty) lastExtracted = extract(editorRef.current.document as never);
      } catch {
        /* éditeur déjà démonté : le relevé précédent reste */
      }
      flush();
      disposed = true;
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
    {
      title: t("syncedBlock"),
      subtext: t("syncedBlockSub"),
      aliases: ["sync", "synchronise", "synced", "miroir"],
      group: t("groupLayout"),
      icon: <RefreshCw size={18} />,
      onItemClick: async () => {
        const source = await createPage({ kind: "synced" });
        insertOrUpdateBlockForSlashMenu(editor, { type: "syncedBlock", props: { sourceId: source.id } });
      },
    },
    {
      title: t("citation"),
      subtext: t("citationSub"),
      aliases: ["cite", "citer", "bibtex", "reference", "source"],
      group: t("groupStudy"),
      icon: <Quote size={18} />,
      onItemClick: () => {
        // Seule cette insertion locale ouvre le choix de la référence.
        askCitePicker();
        editor.insertInlineContent([{ type: "cite", props: { key: "" } }, " "]);
      },
    },
    {
      title: t("bibliography"),
      subtext: t("bibliographySub"),
      aliases: ["bibliographie", "bibliography", "references", "sources"],
      group: t("groupStudy"),
      icon: <LibraryBig size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "bibliography" }),
    },
    {
      title: t("sketch"),
      subtext: t("sketchSub"),
      aliases: ["dessin", "croquis", "schema", "draw", "sketch"],
      group: t("groupLayout"),
      icon: <PenLine size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "sketch" }),
    },
    {
      title: t("pdfBlock"),
      subtext: t("pdfBlockSub"),
      aliases: ["pdf", "document", "support"],
      group: t("groupLayout"),
      icon: <FileText size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "pdf" }),
    },
    {
      title: t("audioNote"),
      subtext: t("audioNoteSub"),
      aliases: ["audio", "micro", "enregistrer", "record", "voice"],
      group: t("groupLayout"),
      icon: <Mic size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "audioNote" }),
    },
    {
      title: t("embeddedDb"),
      subtext: t("embeddedDbSub"),
      aliases: ["database", "base", "tableau", "kanban", "table", "calendrier"],
      group: t("groupLayout"),
      icon: <Table2 size={18} />,
      onItemClick: async () => {
        const page = await createPage({ parentId: pageId, kind: "database", title: t("database") });
        await useStore.getState().refreshPages();
        insertOrUpdateBlockForSlashMenu(editor, { type: "databaseEmbed", props: { pageId: page.id } });
      },
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

  // Cliquer sous le dernier bloc place le curseur à la fin de ce bloc ; une ligne vide n'est
  // ajoutée que si la page se termine par un bloc non textuel (code, image, tableau…).
  const focusEnd = () => {
    const blocks = editor.document;
    const target =
      lastTextBlock(blocks as never) ??
      editor.insertBlocks([{ type: "paragraph" }], blocks[blocks.length - 1], "after")[0];
    editor.setTextCursorPosition(target as never, "end");
    editor.focus();
  };

  return (
    <SyncChain.Provider value={syncChain}>
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
      {editable && !embedded && <div className="no-print h-[24vh] cursor-text" onClick={focusEnd} />}
      {!embedded && !ephemeral && (
        <Comments
          doc={doc}
          editor={editor}
          open={!!commentsOpen}
          author={username ?? t("me")}
          editable={editable}
          onCount={onCommentCount}
          onClose={onCloseComments}
        />
      )}
    </SyncChain.Provider>
  );
});
