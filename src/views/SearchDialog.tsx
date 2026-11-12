import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { searchPages, type SearchHit } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon } from "./common";

/** Affiche un extrait dont les correspondances sont encadrées par \u0001…\u0002. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split("\u0001").map((part, i) => {
        if (i === 0) return part;
        const [hit, rest = ""] = part.split("\u0002");
        return (
          <span key={i}>
            <mark className="bg-transparent font-semibold text-ink">{hit}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}

export function SearchDialog() {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  const close = () => useStore.getState().setSearchOpen(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const rows = await searchPages(query);
      if (live) {
        setHits(rows);
        setIndex(0);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[index]) navigate({ view: "page", id: hits[index].id });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[14vh]" onClick={close}>
      <div
        role="dialog"
        aria-label={t("search")}
        className="w-full max-w-[620px] overflow-hidden rounded-xl bg-pop shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 shadow-[inset_0_-1px_0_var(--color-line)]">
          <Search size={20} strokeWidth={1.75} className="text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("searchPlaceholder")}
            className="h-12 w-full bg-transparent text-lg placeholder:text-faint"
          />
        </div>
        <div className="max-h-[50vh] min-h-16 overflow-y-auto p-1.5">
          {query.trim() && hits.length === 0 && <p className="px-2.5 py-3 text-muted">{t("noResults")}</p>}
          {hits.map((h, i) => (
            <button
              key={h.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => navigate({ view: "page", id: h.id })}
              className={`flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left ${i === index ? "bg-hover" : ""}`}
            >
              <span className="mt-0.5">
                <PageIcon page={{ icon: h.icon, kind: "note" }} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{h.title || t("untitled")}</span>
                {h.snippet && (
                  <span className="block truncate text-xs text-muted">
                    <Snippet text={h.snippet} />
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
        <p className="whitespace-pre px-4 py-2 text-xs text-faint shadow-[inset_0_1px_0_var(--color-line)]">
          {t("searchHint")}
        </p>
      </div>
    </div>
  );
}
