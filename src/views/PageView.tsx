import {
  Eye,
  ALargeSmall,
  BookmarkPlus,
  CodeXml,
  History,
  Printer,
  Copy,
  CornerUpRight,
  Download,
  FileText,
  ImagePlus,
  Lock,
  MoreHorizontal,
  MoveHorizontal,
  SmilePlus,
  Star,
  Table2,
  Trash2,
  MessageSquare,
  Type,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { download } from "../data/backup";
import { saveFile } from "../data/files";
import { BLOCKS_MARK, HTML_MARK } from "../data/importer";
import {
  deleteTemplate,
  listTemplates,
  pendingBlocks,
  pendingHtml,
  pendingMarkdown,
  saveTemplate,
  type CustomTemplate,
} from "../data/templates";
import { snapshot } from "../data/versions";
import {
  backlinks,
  duplicatePage,
  getPageDoc,
  pageTags,
  replacePageDoc,
  updatePageMeta,
  type PageFont,
  type PageMeta,
  type PagePatch,
} from "../data/pages";
import { PageEditor, type PageEditorHandle } from "../editor/PageEditor";
import { template, type TemplateId } from "../editor/templates";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { renderPageHtml, type ExportBlock } from "../export/html";
import { markdownBlocks } from "../export/markdown";
import { prepareExport } from "../export/prepare";
import { printHtml } from "../export/print";
import { Cover, IconButton, Menu, PageIcon, Popover, relativeTime, SectionTitle, TopBar } from "./common";
import { DatabaseView, RowProperties } from "./database/DatabaseView";
import { EmojiPicker } from "./EmojiPicker";
import { moveToTrash } from "./actions";
import { HistoryDialog } from "./HistoryDialog";
import { ShareDialog } from "./ShareDialog";
import { knownRole, type ShareRole } from "../sync/share";

const COVER_COLORS = [
  "#ebeced",
  "#e9e5e3",
  "#faebdd",
  "#fbf3db",
  "#ddedea",
  "#ddebf1",
  "#eae4f2",
  "#f4dfeb",
  "#fbe4e4",
  "#37352f",
];
const FONTS: [PageFont, Key][] = [
  ["sans", "fontSans"],
  ["serif", "fontSerif"],
  ["mono", "fontMono"],
];

const TEMPLATES: [TemplateId, Key][] = [
  ["lecture", "tplLecture"],
  ["cornell", "tplCornell"],
  ["revision", "tplRevision"],
  ["lab", "tplLab"],
];

function PageList({ title, pages }: { title: string; pages: PageMeta[] }) {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  if (pages.length === 0) return null;
  return (
    <section className="mt-10 px-(--page-pad)">
      <SectionTitle>{title}</SectionTitle>
      <div className="-mx-1.5">
        {pages.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate({ view: "page", id: p.id })}
            className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[15px] hover:bg-hover"
          >
            <PageIcon page={p} />
            <span className="truncate font-medium underline decoration-line underline-offset-4">
              {p.title || t("untitled")}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PageView({ id }: { id: string }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  const refreshPages = useStore((s) => s.refreshPages);
  const page = pages.find((p) => p.id === id);

  const [doc, setDoc] = useState<{ ydoc: string | null; rev: number } | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [newTag, setNewTag] = useState("");
  const [share, setShare] = useState<{ online: boolean; peers: number; role: ShareRole }>(() => ({
    online: false,
    peers: 0,
    role: knownRole(page?.share_id),
  }));
  /** Page partagée que ce compte ne peut que lire (ou dont il a été retiré). */
  const readOnly = !!page?.share_id && (share.role === "view" || share.role === "none");
  const [custom, setCustom] = useState<CustomTemplate[]>([]);
  const [pristine, setPristine] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [coverPicker, setCoverPicker] = useState<DOMRect | null>(null);
  const [words, setWords] = useState(0);
  const coverInput = useRef<HTMLInputElement>(null);
  const [mentions, setMentions] = useState<PageMeta[]>([]);
  const editor = useRef<PageEditorHandle>(null);
  const isDatabase = page?.kind === "database";
  const parent = pages.find((p) => p.id === page?.parent_id);

  useEffect(() => {
    let live = true;
    getPageDoc(id).then(({ ydoc, markdown }) => {
      if (!live) return;
      // Page créée hors de l'application (connecteur IA) : son Markdown est mis en forme à l'ouverture.
      if (ydoc === null && markdown?.startsWith(BLOCKS_MARK)) {
        try {
          pendingBlocks.set(id, JSON.parse(markdown.slice(BLOCKS_MARK.length)));
        } catch {
          /* contenu illisible : la page s'ouvre vide */
        }
      } else if (ydoc === null && markdown?.startsWith(HTML_MARK))
        pendingHtml.set(id, markdown.slice(HTML_MARK.length));
      else if (ydoc === null && markdown) pendingMarkdown.set(id, markdown);
      setDoc({ ydoc, rev: 0 });
      if (ydoc === null) void listTemplates().then((list) => live && setCustom(list));
      setPristine(ydoc === null && !markdown);
    });
    backlinks(id).then((rows) => live && setMentions(rows));
    return () => {
      live = false;
    };
  }, [id]);

  // Le titre s'enregistre quand on quitte le champ ; changer d'onglet au clavier ferme la page
  // sans le quitter, d'où cet enregistrement à la fermeture.
  const pendingTitle = useRef<string | null>(null);
  pendingTitle.current = page && title !== page.title ? title : null;
  useEffect(
    () => () => {
      if (pendingTitle.current !== null)
        void updatePageMeta(id, { title: pendingTitle.current }).then(() => useStore.getState().refreshPages());
    },
    [id],
  );
  if (!page)
    return (
      <>
        <TopBar />
        <p className="px-(--page-pad) py-10 text-muted">{t("pageMissing")}</p>
      </>
    );

  const saveMeta = async (patch: PagePatch) => {
    await updatePageMeta(id, patch);
    await refreshPages();
  };
  const tags = pageTags(page);
  const saveTags = (next: string[]) => saveMeta({ tags: next.length ? JSON.stringify(next) : null });

  const trail: PageMeta[] = [];
  for (let p: PageMeta | undefined = page; p; p = pages.find((x) => x.id === p!.parent_id)) trail.unshift(p);

  // Remplace le contenu de la page ; l'état courant est d'abord gardé dans l'historique.
  const applyDoc = async (ydoc: string, body: string) => {
    const current = editor.current;
    if (current) await snapshot(id, current.docState(), current.bodyText(), true);
    await replacePageDoc(id, ydoc, body);
    setPristine(false);
    setDoc((d) => ({ ydoc, rev: (d?.rev ?? 0) + 1 }));
  };

  const fileName = (ext: string) => `${(title || t("untitled")).replace(/[\\/:*?"<>|]/g, "-")}.${ext}`;
  const exportFailed = () => useStore.setState({ toast: { message: t("exportFailed") } });

  /** Page en document HTML autonome (fichiers intégrés, styles compris). */
  const standaloneHtml = async () => {
    const current = editor.current;
    if (!current) throw new Error("editor not ready");
    const blocks = current.blocks() as ExportBlock[];
    const sources = await prepareExport(blocks, {
      pages,
      cover: page.cover,
      readDoc: (ydoc) => current.readDoc(ydoc) as ExportBlock[],
    });
    const meta = {
      title,
      icon: page.icon,
      tags,
      font: page.font,
      small: !!page.small_text,
      wide: !!page.full_width,
      cover: page.cover,
    };
    return renderPageHtml(meta, blocks, sources, t, lang);
  };

  const exportHtml = async () => {
    try {
      download(fileName("html"), await standaloneHtml(), "text/html");
    } catch {
      exportFailed();
    }
  };

  // Le PDF est le même document que l'export HTML, imprimé sans l'interface de l'application.
  const exportPdf = async () => {
    let html: string;
    try {
      html = await standaloneHtml();
    } catch {
      window.print();
      return;
    }
    await printHtml(html);
  };

  const exportMarkdown = async () => {
    const current = editor.current;
    let body = "";
    try {
      if (current) {
        const blocks = current.blocks() as ExportBlock[];
        const sources = await prepareExport(blocks, {
          pages,
          cover: null,
          readDoc: (ydoc) => current.readDoc(ydoc) as ExportBlock[],
          embed: false,
        });
        const prepared = markdownBlocks(blocks, sources, t);
        body = prepared.restore(current.toMarkdown(prepared.blocks));
      }
    } catch {
      exportFailed();
      return;
    }
    download(fileName("md"), `# ${title || t("untitled")}\n\n${body}`, "text/markdown");
  };

  return (
    <>
      <TopBar
        right={
          <>
            {!!page.locked && (
              <span className="mr-1 flex items-center gap-1 text-muted">
                <Lock size={14} />
                {t("locked")}
              </span>
            )}
            {readOnly && (
              <span className="mr-1 flex items-center gap-1 text-muted">
                <Eye size={14} />
                {t(share.role === "none" ? "shareRemoved" : "readOnly")}
              </span>
            )}
            {!isDatabase && (
              <button
                onClick={() => setCommentsOpen((open) => !open)}
                aria-label={t("comments")}
                title={t("comments")}
                className={`flex h-7 items-center gap-1 rounded-md px-1.5 hover:bg-hover ${commentsOpen ? "bg-hover text-ink" : "text-muted"}`}
              >
                <MessageSquare size={16} strokeWidth={1.75} />
                {commentCount > 0 && <span className="text-xs tabular-nums">{commentCount}</span>}
              </button>
            )}
            {!isDatabase && (
              <button
                onClick={() => setShareOpen(true)}
                className={`mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-hover ${
                  page.share_id ? (share.online ? "text-accent-text" : "text-muted") : "text-muted"
                }`}
              >
                <Users size={16} strokeWidth={1.75} />
                <span className="max-sm:hidden">
                  {page.share_id ? (share.peers > 1 ? `${t("shared")} · ${share.peers}` : t("shared")) : t("share")}
                </span>
              </button>
            )}
            <span className="mr-1 hidden text-faint sm:block">
              {t("edited")} {relativeTime(page.updated_at, lang)}
            </span>
            <IconButton
              label={page.favorite ? t("removeFavorite") : t("addFavorite")}
              onClick={() => saveMeta({ favorite: !page.favorite })}
            >
              <Star size={18} strokeWidth={1.75} className={page.favorite ? "fill-[#f6c050] text-[#f6c050]" : ""} />
            </IconButton>
            <span onPointerDown={() => setWords(editor.current?.wordCount() ?? 0)}>
              <Menu
                label={t("more")}
                align="right"
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover"
                trigger={<MoreHorizontal size={18} strokeWidth={1.75} />}
                items={[
                  ...FONTS.map(([font, key]) => ({
                    icon: <Type size={16} />,
                    label: t(key),
                    checked: page.font === font,
                    onClick: () => saveMeta({ font }),
                  })),
                  "separator" as const,
                  {
                    icon: <ALargeSmall size={16} />,
                    label: t("smallText"),
                    checked: !!page.small_text,
                    onClick: () => saveMeta({ small_text: !page.small_text }),
                  },
                  {
                    icon: <MoveHorizontal size={16} />,
                    label: t("fullWidth"),
                    checked: !!page.full_width,
                    onClick: () => saveMeta({ full_width: !page.full_width }),
                  },
                  {
                    icon: <Lock size={16} />,
                    label: t("lockPage"),
                    checked: !!page.locked,
                    onClick: () => saveMeta({ locked: !page.locked }),
                  },
                  "separator",
                  {
                    icon: <Copy size={16} />,
                    label: t("duplicate"),
                    onClick: async () => {
                      const copyId = await duplicatePage(id, t("copySuffix"));
                      await refreshPages();
                      navigate({ view: "page", id: copyId });
                    },
                  },
                  {
                    icon: <CornerUpRight size={16} />,
                    label: t("moveTo"),
                    onClick: () => useStore.setState({ moveIds: [id] }),
                  },
                  {
                    icon: <Download size={16} />,
                    label: t("exportMd"),
                    onClick: exportMarkdown,
                  },
                  ...(isDatabase
                    ? []
                    : [
                        { icon: <CodeXml size={16} />, label: t("exportHtml"), onClick: exportHtml },
                        { icon: <Printer size={16} />, label: t("print"), onClick: exportPdf },
                        "separator" as const,
                        { icon: <History size={16} />, label: t("history"), onClick: () => setHistoryOpen(true) },
                        {
                          icon: <BookmarkPlus size={16} />,
                          label: t("saveAsTemplate"),
                          onClick: () =>
                            editor.current && saveTemplate(title || t("untitled"), editor.current.docState(), id),
                        },
                      ]),
                  "separator",
                  {
                    icon: <Trash2 size={16} />,
                    label: t("moveToTrash"),
                    onClick: () => moveToTrash(page),
                  },
                  "separator",
                  { note: `${words} ${t("words")}` },
                ]}
              />
            </span>
          </>
        }
      >
        {trail.map((p, i) => (
          <Fragment key={p.id}>
            {i > 0 && <span className="text-faint">/</span>}
            <button
              onClick={() => navigate({ view: "page", id: p.id })}
              className={`flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 hover:bg-hover ${
                i < trail.length - 1 ? "max-sm:hidden" : ""
              }`}
            >
              <PageIcon page={p} size={16} />
              <span className="max-w-40 truncate">{p.title || t("untitled")}</span>
            </button>
          </Fragment>
        ))}
      </TopBar>

      {page.cover && (
        <div className="group/cover relative h-[26vh] max-h-[280px] min-h-[140px] w-full bg-panel">
          <Cover value={page.cover} />
          {!page.locked && (
            <div className="absolute bottom-3 right-3 flex overflow-hidden rounded-md bg-pop text-xs text-muted opacity-0 shadow-pop focus-within:opacity-100 group-hover/cover:opacity-100 max-md:opacity-100">
              <button
                className="h-7 px-2 hover:bg-hover"
                onClick={(e) => setCoverPicker(e.currentTarget.getBoundingClientRect())}
              >
                {t("changeCover")}
              </button>
              <button className="h-7 px-2 hover:bg-hover" onClick={() => saveMeta({ cover: null })}>
                {t("removeCover")}
              </button>
            </div>
          )}
        </div>
      )}
      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await saveMeta({ cover: await saveFile(file) });
          } catch {
            alert(t("fileTooLarge"));
          }
        }}
      />
      {coverPicker && (
        <Popover anchor={coverPicker} onClose={() => setCoverPicker(null)} width={236} align="right">
          <div className="grid grid-cols-5 gap-1.5 p-1.5">
            {COVER_COLORS.map((c) => (
              <button
                key={c}
                aria-label={c}
                className="h-8 rounded shadow-[inset_0_0_0_1px_var(--color-line)]"
                style={{ background: c }}
                onClick={() => {
                  setCoverPicker(null);
                  void saveMeta({ cover: `color:${c}` });
                }}
              />
            ))}
          </div>
          <button
            className="flex h-7 w-full items-center gap-2 rounded px-2 hover:bg-hover"
            onClick={() => {
              setCoverPicker(null);
              coverInput.current?.click();
            }}
          >
            <ImagePlus size={16} className="text-muted" />
            {t("uploadImage")}
          </button>
        </Popover>
      )}

      <div
        className={`mx-auto pb-40 ${page.full_width || isDatabase ? "" : "max-w-[900px]"} ${
          page.font === "sans" ? "" : `page-${page.font}`
        } ${page.small_text ? "page-small" : ""}`}
      >
        <div className={`group px-(--page-pad) ${page.cover ? (page.icon ? "" : "pt-6") : "pt-16"}`}>
          {page.icon && (
            <button
              aria-label={t("addIcon")}
              disabled={!!page.locked}
              onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
              className={`relative -ml-1 mb-1 grid size-[72px] place-items-center rounded-md text-[60px] leading-none enabled:hover:bg-hover ${
                page.cover ? "-mt-9" : ""
              }`}
            >
              {page.icon}
            </button>
          )}
          {!page.locked && (!page.icon || !page.cover) && (
            <div className="no-print -ml-1.5 mb-1 flex h-7 gap-1 text-faint opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
              {!page.icon && (
                <button
                  onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
                  className="flex items-center gap-1.5 rounded px-1.5 hover:bg-hover"
                >
                  <SmilePlus size={16} />
                  {t("addIcon")}
                </button>
              )}
              {!page.cover && (
                <button
                  onClick={(e) => setCoverPicker(e.currentTarget.getBoundingClientRect())}
                  className="flex items-center gap-1.5 rounded px-1.5 hover:bg-hover"
                >
                  <ImagePlus size={16} />
                  {t("addCover")}
                </button>
              )}
            </div>
          )}
          {picker && (
            <EmojiPicker
              anchor={picker}
              onClose={() => setPicker(null)}
              onPick={(icon) => void saveMeta({ icon })}
              onRemove={page.icon ? () => void saveMeta({ icon: null }) : undefined}
            />
          )}

          {(page.kind === "semester" || page.kind === "course") && (
            <p className="mb-1 text-xs font-medium text-muted">{t(page.kind === "semester" ? "semester" : "course")}</p>
          )}
          <input
            value={title}
            autoFocus={!page.title}
            readOnly={!!page.locked}
            placeholder={t("untitled")}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== page.title && saveMeta({ title })}
            onKeyDown={(e) => {
              // Entrée ou flèche bas : on passe du titre au contenu, comme dans un document.
              if (e.key !== "Enter" && e.key !== "ArrowDown") return;
              e.preventDefault();
              e.currentTarget.blur();
              editor.current?.focus();
            }}
            className="page-title w-full bg-transparent text-[40px] font-bold leading-[1.2] placeholder:text-faint"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="tag tag-gray flex items-center gap-1">
                <button
                  title={t("search")}
                  onClick={() => useStore.setState({ searchOpen: true, searchSeed: `#${tag}` })}
                  className="hover:underline"
                >
                  #{tag}
                </button>
                {!page.locked && (
                  <button
                    aria-label={`${t("delete")} ${tag}`}
                    onClick={() => saveTags(tags.filter((x) => x !== tag))}
                    className="no-print opacity-60 hover:opacity-100"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!page.locked && (
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  const tag = newTag.trim().replace(/^#/, "");
                  if (e.key !== "Enter" || !tag) return;
                  setNewTag("");
                  if (!tags.includes(tag)) void saveTags([...tags, tag]);
                }}
                placeholder={tags.length ? "+" : `+ ${t("addTag")}`}
                aria-label={t("addTag")}
                className={`no-print h-6 rounded bg-transparent px-1 text-[13px] placeholder:text-faint hover:bg-hover focus:bg-hover ${
                  tags.length ? "w-24" : "w-44 opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                }`}
              />
            )}
          </div>
          {parent?.kind === "database" && <RowProperties page={page} databaseId={parent.id} />}
        </div>

        {isDatabase && <DatabaseView page={page} />}
        <div className={isDatabase ? "hidden" : "mt-2"}>
          {doc && !isDatabase && (
            <PageEditor
              key={doc.rev}
              ref={editor}
              pageId={id}
              initialDoc={doc.ydoc}
              saveOnMount={doc.rev > 0}
              shareId={page.share_id}
              onShareState={setShare}
              commentsOpen={commentsOpen}
              onCommentCount={setCommentCount}
              onCloseComments={() => setCommentsOpen(false)}
              editable={!page.locked && !readOnly}
              onFirstEdit={() => setPristine(false)}
            />
          )}
        </div>

        {pristine && !page.locked && !isDatabase && (
          <div className="mt-6 px-(--page-pad) text-muted">
            <p className="mb-1 text-faint">{t("template")}</p>
            <div className="-mx-1.5">
              {custom.map((tpl) => (
                <div key={tpl.id} className="group flex h-8 items-center rounded-md hover:bg-hover">
                  <button
                    onClick={() => applyDoc(tpl.ydoc, "")}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-[15px]"
                  >
                    <BookmarkPlus size={18} strokeWidth={1.75} />
                    <span className="truncate">{tpl.name}</span>
                  </button>
                  <IconButton
                    label={t("delete")}
                    className="mr-1 size-6 opacity-0 focus:opacity-100 group-hover:opacity-100"
                    onClick={async () => {
                      await deleteTemplate(tpl.id);
                      setCustom(await listTemplates());
                    }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              ))}
              {TEMPLATES.map(([tid, key]) => (
                <button
                  key={tid}
                  onClick={() => editor.current?.applyTemplate(template(tid, lang))}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[15px] hover:bg-hover"
                >
                  <FileText size={18} strokeWidth={1.75} />
                  {t(key)}
                </button>
              ))}
              <button
                onClick={() => saveMeta({ kind: "database" })}
                className="flex h-8 w-full items-center gap-2 rounded-md px-1.5 text-left text-[15px] hover:bg-hover"
              >
                <Table2 size={18} strokeWidth={1.75} />
                {t("database")}
              </button>
            </div>
          </div>
        )}

        {!isDatabase && <PageList title={t("subpages")} pages={pages.filter((p) => p.parent_id === id)} />}
        <PageList title={t("backlinks")} pages={mentions} />
        {shareOpen && (
          <ShareDialog
            page={page}
            peers={share.peers}
            online={share.online}
            role={share.role}
            getDoc={() => editor.current?.docState() ?? null}
            onClose={() => setShareOpen(false)}
          />
        )}
        {historyOpen && (
          <HistoryDialog
            pageId={id}
            onClose={() => setHistoryOpen(false)}
            onRestore={async (version) => {
              setHistoryOpen(false);
              await applyDoc(version.ydoc, version.body);
            }}
          />
        )}
      </div>
    </>
  );
}
