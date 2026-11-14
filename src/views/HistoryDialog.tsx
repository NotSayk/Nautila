import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { listVersions, type Version } from "../data/versions";
import { PageEditor, type PageEditorHandle } from "../editor/PageEditor";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";

/** Une version illisible ne doit pas faire tomber toute la boîte : elle affiche un message à la place. */
class PreviewBoundary extends Component<{ message: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="p-6 text-muted">{this.props.message}</p> : this.props.children;
  }
}

export function HistoryDialog({
  pageId,
  onClose,
  onRestore,
}: {
  pageId: string;
  onClose: () => void;
  onRestore: (version: Version) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  useOverlay(onClose);
  const [versions, setVersions] = useState<Version[]>();
  const [selected, setSelected] = useState<Version>();
  const preview = useRef<PageEditorHandle>(null);
  const [words, setWords] = useState<number>();

  useEffect(() => {
    listVersions(pageId).then((list) => {
      setVersions(list);
      setSelected(list[0]);
    });
  }, [pageId]);

  // Nombre de mots lu dans l'aperçu une fois affiché (le LaTeX n'en fait pas partie) ;
  // en attendant, celui du texte indexé.
  useEffect(() => {
    if (!selected) return;
    setWords(selected.body.split(/\s+/).filter(Boolean).length);
    const timer = setTimeout(() => {
      try {
        const count = preview.current?.wordCount();
        if (count !== undefined) setWords(count);
      } catch {
        /* aperçu pas prêt : on garde le décompte du texte indexé */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [selected]);

  const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fullDate = new Intl.DateTimeFormat(lang, { dateStyle: "full", timeStyle: "short" });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("history")}
        className="flex h-[70vh] w-full max-w-3xl overflow-hidden rounded-xl bg-pop shadow-pop max-sm:flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="w-56 shrink-0 overflow-y-auto bg-panel p-1.5 max-sm:max-h-40 max-sm:w-full">
          <p className="px-2 py-1.5 text-xs font-medium text-faint">{t("history")}</p>
          {versions?.map((v) => (
            <button
              key={v.id}
              onClick={() => setSelected(v)}
              className={`block h-8 w-full rounded-md px-2 text-left hover:bg-hover ${v.id === selected?.id ? "bg-hover font-medium" : "text-muted"}`}
            >
              {date.format(v.created_at)}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {versions?.length === 0 && <p className="p-6 text-muted">{t("noVersions")}</p>}
          {selected && (
            <>
              <p className="px-6 pt-4 text-xs text-muted">
                {fullDate.format(selected.created_at)}
                {words !== undefined && ` · ${words} ${t("words")}`}
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto pb-6 pt-2">
                <PreviewBoundary key={selected.id} message={t("versionPreviewError")}>
                  <PageEditor
                    ref={preview}
                    pageId={`version:${selected.id}`}
                    initialDoc={selected.ydoc}
                    editable={false}
                    ephemeral
                    embedded
                  />
                </PreviewBoundary>
              </div>
              <div className="flex justify-end gap-2 p-3 shadow-[inset_0_1px_0_var(--color-line)]">
                <button className="h-8 rounded-md px-3 hover:bg-hover" onClick={onClose}>
                  {t("cancel")}
                </button>
                <button
                  className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95"
                  onClick={() => onRestore(selected)}
                >
                  {t("restoreVersion")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
