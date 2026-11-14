import { CornerLeftUp } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { movePage, type PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon } from "./common";
import { Modal, notify } from "./dialogs";

const LIMIT = 40;

export function MoveDialog({ ids }: { ids: string[] }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const close = () => useStore.setState({ moveIds: null });
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const uid = useId();

  // Une page ne peut pas être déplacée dans elle-même ni dans sa descendance.
  const matches = useMemo(() => {
    const blocked = new Set(ids);
    for (let grew = true; grew; ) {
      grew = false;
      for (const p of pages)
        if (p.parent_id && blocked.has(p.parent_id) && !blocked.has(p.id)) {
          blocked.add(p.id);
          grew = true;
        }
    }
    const q = query.trim().toLowerCase();
    return pages.filter((p) => !blocked.has(p.id) && (p.title || t("untitled")).toLowerCase().includes(q));
  }, [pages, ids, query, t]);
  const targets = matches.slice(0, LIMIT);

  /** Chemin d'une page : les titres de ses ancêtres, pour distinguer les titres identiques. */
  const pathOf = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    return (p: PageMeta) => {
      const parts: string[] = [];
      const seen = new Set([p.id]);
      for (let a = p.parent_id ? byId.get(p.parent_id) : undefined; a && !seen.has(a.id); a = a.parent_id ? byId.get(a.parent_id) : undefined) {
        seen.add(a.id);
        parts.unshift(a.title || t("untitled"));
      }
      return parts.join(" / ");
    };
  }, [pages, t]);

  const move = async (parentId: string | null) => {
    let refused = false;
    for (const id of ids) if (!(await movePage(id, parentId))) refused = true;
    await useStore.getState().refreshPages();
    if (refused) notify(t("moveFailed"));
    // La sélection multiple de la barre latérale se vide une fois le déplacement fait.
    useStore.setState((s) => ({ moveIds: null, moveCount: s.moveCount + 1 }));
  };

  // Entrée 0 : la racine ; les suivantes : les pages proposées.
  const count = targets.length + 1;
  const pick = (i: number) => void move(i === 0 ? null : targets[i - 1].id);
  const optionId = (i: number) => `${uid}-opt-${i}`;
  useEffect(() => {
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const row = "flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left";
  return (
    <Modal label={t("moveSearch")} onClose={close} className="w-full max-w-[480px] overflow-hidden">
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={`${uid}-list`}
        aria-activedescendant={optionId(index)}
        aria-autocomplete="list"
        aria-label={t("moveSearch")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, count - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(index);
          }
        }}
        placeholder={t("moveSearch")}
        className="no-ring h-11 w-full bg-transparent px-4 shadow-[inset_0_-1px_0_var(--color-line)] placeholder:text-faint"
      />
      <div id={`${uid}-list`} role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
        <div
          id={optionId(0)}
          role="option"
          aria-selected={index === 0}
          className={`${row} text-muted ${index === 0 ? "bg-hover" : ""}`}
          onMouseMove={() => index !== 0 && setIndex(0)}
          onClick={() => pick(0)}
        >
          <CornerLeftUp size={18} strokeWidth={1.75} />
          {t("moveToRoot")}
        </div>
        {targets.map((p, i) => {
          const path = pathOf(p);
          const note = p.kind === "database" ? t("moveIntoDatabase") : "";
          return (
            <div
              key={p.id}
              id={optionId(i + 1)}
              role="option"
              aria-selected={index === i + 1}
              className={`${row} ${index === i + 1 ? "bg-hover" : ""}`}
              onMouseMove={() => index !== i + 1 && setIndex(i + 1)}
              onClick={() => pick(i + 1)}
            >
              <PageIcon page={p} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.title || t("untitled")}</span>
                {(path || note) && (
                  <span className="block truncate text-xs text-muted">{[path, note].filter(Boolean).join(" · ")}</span>
                )}
              </span>
            </div>
          );
        })}
        {matches.length > LIMIT && (
          <p className="px-2.5 py-2 text-xs text-muted">{`+${matches.length - LIMIT} ${t("moreResults")}`}</p>
        )}
      </div>
    </Modal>
  );
}
