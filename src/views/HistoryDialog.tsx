import { useEffect, useState } from "react";
import { listVersions, type Version } from "../data/versions";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";

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

  useEffect(() => {
    listVersions(pageId).then((list) => {
      setVersions(list);
      setSelected(list[0]);
    });
  }, [pageId]);

  const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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
              <pre className="flex-1 overflow-y-auto whitespace-pre-wrap p-6 font-sans text-[15px] leading-6">
                {selected.body}
              </pre>
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
