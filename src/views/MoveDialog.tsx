import { CornerLeftUp } from "lucide-react";
import { useMemo, useState } from "react";
import { movePage } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon } from "./common";

export function MoveDialog({ id }: { id: string }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const close = () => useStore.setState({ moveId: null });
  const [query, setQuery] = useState("");

  // Une page ne peut pas être déplacée dans elle-même ni dans sa descendance.
  const targets = useMemo(() => {
    const blocked = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of pages)
        if (p.parent_id && blocked.has(p.parent_id) && !blocked.has(p.id)) {
          blocked.add(p.id);
          grew = true;
        }
    }
    const q = query.trim().toLowerCase();
    return pages.filter((p) => !blocked.has(p.id) && (p.title || t("untitled")).toLowerCase().includes(q)).slice(0, 40);
  }, [pages, id, query, t]);

  const move = async (parentId: string | null) => {
    await movePage(id, parentId);
    await useStore.getState().refreshPages();
    close();
  };

  const row = "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-hover";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[14vh]" onClick={close}>
      <div
        role="dialog"
        aria-label={t("moveSearch")}
        className="w-full max-w-[480px] overflow-hidden rounded-xl bg-pop shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && close()}
          placeholder={t("moveSearch")}
          className="h-11 w-full bg-transparent px-4 shadow-[inset_0_-1px_0_var(--color-line)] placeholder:text-faint"
        />
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          <button className={`${row} text-muted`} onClick={() => move(null)}>
            <CornerLeftUp size={18} strokeWidth={1.75} />
            {t("moveToRoot")}
          </button>
          {targets.map((p) => (
            <button key={p.id} className={row} onClick={() => move(p.id)}>
              <PageIcon page={p} />
              <span className="truncate font-medium">{p.title || t("untitled")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
