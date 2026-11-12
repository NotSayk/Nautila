import { Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { download } from "../data/backup";
import { backlinks, getPageDoc, trashPage, updatePageMeta, type PageMeta } from "../data/pages";
import { PageEditor, type PageEditorHandle } from "../editor/PageEditor";
import { template, type TemplateId } from "../editor/templates";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { PageIcon } from "./common";

const EMOJIS = "📘 📗 📕 📙 📓 📝 ✏️ 🧮 📐 🧪 🔬 🧬 ⚛️ 💻 🌍 🏛️ ⚖️ 💼 🎨 🎵 🗣️ 🧠 💡 🎯 📅 ⭐".split(" ");
const TEMPLATES: [TemplateId, Key][] = [
  ["lecture", "tplLecture"],
  ["cornell", "tplCornell"],
  ["revision", "tplRevision"],
  ["lab", "tplLab"],
];

export function PageView({ id }: { id: string }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const page = useStore((s) => s.pages.find((p) => p.id === id));
  const navigate = useStore((s) => s.navigate);
  const refreshPages = useStore((s) => s.refreshPages);

  const [doc, setDoc] = useState<{ ydoc: string | null } | undefined>();
  const [pristine, setPristine] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [picker, setPicker] = useState(false);
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

  if (!page) return <p className="p-10 text-muted">{t("pageMissing")}</p>;

  const saveMeta = async (patch: { title?: string; icon?: string | null }) => {
    await updatePageMeta(id, patch);
    await refreshPages();
  };

  return (
    <div className="mx-auto max-w-4xl pb-40 pt-14">
      <div className="px-[54px] max-sm:px-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="relative">
            <button
              onClick={() => setPicker((v) => !v)}
              className="grid size-12 place-items-center rounded-lg hover:bg-hover"
              aria-label="icon"
            >
              <PageIcon page={page} size={34} />
            </button>
            {picker && (
              <div className="absolute z-20 mt-1 grid w-64 grid-cols-7 gap-1 rounded-lg border border-line bg-bg p-2 shadow-lg">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    className="rounded p-1 text-xl hover:bg-hover"
                    onClick={() => {
                      setPicker(false);
                      void saveMeta({ icon: e });
                    }}
                  >
                    {e}
                  </button>
                ))}
                <button
                  className="col-span-7 rounded py-1 text-xs text-muted hover:bg-hover"
                  onClick={() => {
                    setPicker(false);
                    void saveMeta({ icon: null });
                  }}
                >
                  {t("delete")}
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-1 text-muted">
            <button
              title={t("exportMd")}
              aria-label={t("exportMd")}
              className="grid size-8 place-items-center rounded-md hover:bg-hover"
              onClick={() => {
                const md = `# ${title || t("untitled")}\n\n${editor.current?.toMarkdown() ?? ""}`;
                download(`${(title || t("untitled")).replace(/[\\/:*?"<>|]/g, "-")}.md`, md, "text/markdown");
              }}
            >
              <Download size={16} />
            </button>
            <button
              title={t("moveToTrash")}
              aria-label={t("moveToTrash")}
              className="grid size-8 place-items-center rounded-md hover:bg-hover"
              onClick={async () => {
                await trashPage(id);
                await refreshPages();
                await useStore.getState().refreshDue();
                navigate({ view: "home" });
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {page.kind !== "note" && (
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            {t(page.kind === "semester" ? "semester" : "course")}
          </p>
        )}
        <input
          value={title}
          autoFocus={!page.title}
          placeholder={t("untitled")}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== page.title && saveMeta({ title })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-full bg-transparent text-4xl font-bold outline-none placeholder:text-line"
        />

        {pristine && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t("template")} :</span>
            {TEMPLATES.map(([tid, key]) => (
              <button
                key={tid}
                onClick={() => editor.current?.applyTemplate(template(tid, lang))}
                className="rounded-full border border-line px-3 py-1 hover:bg-hover"
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        {doc && <PageEditor ref={editor} pageId={id} initialDoc={doc.ydoc} onFirstEdit={() => setPristine(false)} />}
      </div>

      {mentions.length > 0 && (
        <div className="mt-10 px-[54px] max-sm:px-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("backlinks")}</p>
          {mentions.map((m) => (
            <button
              key={m.id}
              onClick={() => navigate({ view: "page", id: m.id })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              <PageIcon page={m} />
              {m.title || t("untitled")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
