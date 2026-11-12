import {
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
  Type,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { download } from "../data/backup";
import { saveFile } from "../data/files";
import { deleteTemplate, listTemplates, saveTemplate, type CustomTemplate } from "../data/templates";
import { snapshot } from "../data/versions";
import {
  backlinks,
  duplicatePage,
  getPageDoc,
  replacePageDoc,
  trashPage,
  updatePageMeta,
  type PageFont,
  type PageMeta,
  type PagePatch,
} from "../data/pages";
import { PageEditor, type PageEditorHandle } from "../editor/PageEditor";
import { template, type TemplateId } from "../editor/templates";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { Cover, IconButton, Menu, PageIcon, Popover, relativeTime, SectionTitle, TopBar } from "./common";
import { DatabaseView, RowProperties } from "./database/DatabaseView";
import { EmojiPicker } from "./EmojiPicker";
import { HistoryDialog } from "./HistoryDialog";

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
    getPageDoc(id).then((ydoc) => {
      if (!live) return;
      setDoc({ ydoc, rev: 0 });
      if (ydoc === null) void listTemplates().then((list) => live && setCustom(list));
      setPristine(ydoc === null);
    });
    backlinks(id).then((rows) => live && setMentions(rows));
    return () => {
      live = false;
    };
  }, [id]);

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

  const exportHtml = () => {
    const name = title || t("untitled");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name.replace(/[<&]/g, "")}</title></head><body><h1>${name.replace(/[<&]/g, "")}</h1>${editor.current?.toHTML() ?? ""}</body></html>`;
    download(`${name.replace(/[\\/:*?"<>|]/g, "-")}.html`, html, "text/html");
  };

  const exportMarkdown = () => {
    const name = title || t("untitled");
    download(
      `${name.replace(/[\\/:*?"<>|]/g, "-")}.md`,
      `# ${name}\n\n${editor.current?.toMarkdown() ?? ""}`,
      "text/markdown",
    );
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
                    onClick: () => useStore.setState({ moveId: id }),
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
                        { icon: <Printer size={16} />, label: t("print"), onClick: () => window.print() },
                        "separator" as const,
                        { icon: <History size={16} />, label: t("history"), onClick: () => setHistoryOpen(true) },
                        {
                          icon: <BookmarkPlus size={16} />,
                          label: t("saveAsTemplate"),
                          onClick: () =>
                            editor.current && saveTemplate(title || t("untitled"), editor.current.docState()),
                        },
                      ]),
                  "separator",
                  {
                    icon: <Trash2 size={16} />,
                    label: t("moveToTrash"),
                    onClick: async () => {
                      await trashPage(id);
                      await refreshPages();
                      await useStore.getState().refreshDue();
                      navigate({ view: "home" });
                    },
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
            <div className="-ml-1.5 mb-1 flex h-7 gap-1 text-faint opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
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
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="page-title w-full bg-transparent text-[40px] font-bold leading-[1.2] placeholder:text-faint"
          />
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
              editable={!page.locked}
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
