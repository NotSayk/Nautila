import { Download, FileText, MoreHorizontal, MoveHorizontal, SmilePlus, Star, Trash2 } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { download } from "../data/backup";
import { backlinks, getPageDoc, trashPage, updatePageMeta, type PageMeta } from "../data/pages";
import { PageEditor, type PageEditorHandle } from "../editor/PageEditor";
import { template, type TemplateId } from "../editor/templates";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { IconButton, Menu, PageIcon, Popover, relativeTime, SectionTitle, TopBar } from "./common";

const EMOJIS = "📘 📗 📕 📙 📓 📝 ✏️ 🧮 📐 🧪 🔬 🧬 ⚛️ 💻 🌍 🏛️ ⚖️ 💼 🎨 🎵 🗣️ 🧠 💡 🎯 📅 ⭐ 🔥 📊".split(" ");
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

  const [doc, setDoc] = useState<{ ydoc: string | null } | undefined>();
  const [pristine, setPristine] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [mentions, setMentions] = useState<PageMeta[]>([]);
  const editor = useRef<PageEditorHandle>(null);

  useEffect(() => {
    let live = true;
    getPageDoc(id).then((ydoc) => {
      if (!live) return;
      setDoc({ ydoc });
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

  const saveMeta = async (patch: Parameters<typeof updatePageMeta>[1]) => {
    await updatePageMeta(id, patch);
    await refreshPages();
  };

  const trail: PageMeta[] = [];
  for (let p: PageMeta | undefined = page; p; p = pages.find((x) => x.id === p!.parent_id)) trail.unshift(p);

  const exportMarkdown = () => {
    const name = title || t("untitled");
    download(`${name.replace(/[\\/:*?"<>|]/g, "-")}.md`, `# ${name}\n\n${editor.current?.toMarkdown() ?? ""}`, "text/markdown");
  };

  return (
    <>
      <TopBar
        right={
          <>
            <span className="mr-1 hidden text-faint sm:block">
              {t("edited")} {relativeTime(page.updated_at, lang)}
            </span>
            <IconButton
              label={page.favorite ? t("removeFavorite") : t("addFavorite")}
              onClick={() => saveMeta({ favorite: !page.favorite })}
            >
              <Star size={18} strokeWidth={1.75} className={page.favorite ? "fill-[#f6c050] text-[#f6c050]" : ""} />
            </IconButton>
            <Menu
              label={t("more")}
              align="right"
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover"
              trigger={<MoreHorizontal size={18} strokeWidth={1.75} />}
              items={[
                {
                  icon: <MoveHorizontal size={16} />,
                  label: t("fullWidth"),
                  checked: !!page.full_width,
                  onClick: () => saveMeta({ full_width: !page.full_width }),
                },
                { icon: <Download size={16} />, label: t("exportMd"), onClick: exportMarkdown },
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
              ]}
            />
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

      <div className={`mx-auto pb-40 ${page.full_width ? "" : "max-w-[900px]"}`}>
        <div className="group px-(--page-pad) pt-16">
          {page.icon ? (
            <button
              aria-label={t("addIcon")}
              onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
              className="-ml-1 mb-2 grid size-[72px] place-items-center rounded-md text-[60px] leading-none hover:bg-hover"
            >
              {page.icon}
            </button>
          ) : (
            <button
              onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
              className="-ml-1.5 mb-1 flex h-7 items-center gap-1.5 rounded px-1.5 text-faint opacity-0 hover:bg-hover focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
            >
              <SmilePlus size={16} />
              {t("addIcon")}
            </button>
          )}
          {picker && (
            <Popover anchor={picker} onClose={() => setPicker(null)} width={292}>
              <div className="grid grid-cols-7 gap-0.5 p-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    className="grid size-9 place-items-center rounded text-xl hover:bg-hover"
                    onClick={() => {
                      setPicker(null);
                      void saveMeta({ icon: e });
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
              {page.icon && (
                <button
                  className="mt-1 h-7 w-full rounded text-muted hover:bg-hover"
                  onClick={() => {
                    setPicker(null);
                    void saveMeta({ icon: null });
                  }}
                >
                  {t("removeIcon")}
                </button>
              )}
            </Popover>
          )}

          {page.kind !== "note" && (
            <p className="mb-1 text-xs font-medium text-muted">{t(page.kind === "semester" ? "semester" : "course")}</p>
          )}
          <input
            value={title}
            autoFocus={!page.title}
            placeholder={t("untitled")}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== page.title && saveMeta({ title })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-full bg-transparent text-[40px] font-bold leading-[1.2] placeholder:text-faint"
          />
        </div>

        <div className="mt-2">
          {doc && <PageEditor ref={editor} pageId={id} initialDoc={doc.ydoc} onFirstEdit={() => setPristine(false)} />}
        </div>

        {pristine && (
          <div className="mt-6 px-(--page-pad) text-muted">
            <p className="mb-1 text-faint">{t("template")}</p>
            <div className="-mx-1.5">
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
            </div>
          </div>
        )}

        <PageList title={t("subpages")} pages={pages.filter((p) => p.parent_id === id)} />
        <PageList title={t("backlinks")} pages={mentions} />
      </div>
    </>
  );
}
