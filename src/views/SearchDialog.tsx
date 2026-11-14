import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { pageTags, searchPages, type PageKind, type SearchHit } from "../data/pages";
import type { Key } from "../i18n";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon } from "./common";
import { Modal } from "./dialogs";

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

const KINDS: [PageKind | null, Key][] = [
  [null, "allKinds"],
  ["note", "pages"],
  ["course", "course"],
  ["database", "database"],
];

export function SearchDialog() {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  const close = () => useStore.getState().setSearchOpen(false);
  const [query, setQuery] = useState(() => useStore.getState().searchSeed);
  const [allHits, setHits] = useState<SearchHit[]>([]);
  /** Requête à laquelle correspondent `allHits` : tant qu'elle diffère de la saisie, les résultats sont périmés. */
  const [hitsFor, setHitsFor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [kind, setKind] = useState<PageKind | null>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  /** Entrée pressée avant l'arrivée des résultats : on ouvre le premier dès qu'ils sont là (true = nouvel onglet). */
  const pendingOpen = useRef<boolean | null>(null);
  const scrollTo = useRef(false);
  const pages = useStore((s) => s.pages);
  // Sans saisie, la palette propose les pages récentes : on change de page en deux touches.
  const recent: SearchHit[] = [...pages]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 8)
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: "" }));
  const stale = !!query.trim() && hitsFor !== query;
  const source = query.trim() ? (stale ? [] : allHits) : recent;
  const hits = kind ? source.filter((h) => h.kind === kind) : source;
  const open = (id: string, inTab: boolean) => {
    const route = { view: "page", id } as const;
    if (inTab) useStore.getState().openTab(route);
    else navigate(route);
  };

  // L'élément actif reste visible quand on navigue aux flèches.
  useEffect(() => {
    if (!scrollTo.current) return;
    scrollTo.current = false;
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      // « #étiquette » liste les pages qui la portent ; sinon recherche dans le texte.
      const tag = /^#(.+)/.exec(query.trim())?.[1].toLowerCase();
      let rows: SearchHit[] = [];
      try {
        rows = tag
          ? useStore
              .getState()
              .pages.filter((p) => pageTags(p).some((x) => x.toLowerCase() === tag))
              .map((p) => ({ id: p.id, title: p.title, icon: p.icon, kind: p.kind, snippet: "" }))
          : await searchPages(query);
      } catch {
        /* recherche impossible : aucun résultat */
      }
      if (!live) return;
      setHits(rows);
      setHitsFor(query);
      setIndex(0);
      const wanted = pendingOpen.current;
      pendingOpen.current = null;
      const first = (kindRef.current ? rows.filter((h) => h.kind === kindRef.current) : rows)[0];
      if (wanted !== null && first) open(first.id, wanted);
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      scrollTo.current = true;
      setIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      scrollTo.current = true;
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const inTab = e.ctrlKey || e.metaKey;
      // Résultats de l'ancienne saisie : on attend les bons plutôt que d'ouvrir un résultat périmé.
      if (stale) pendingOpen.current = inTab;
      else if (hits[index]) open(hits[index].id, inTab);
    }
  };

  return (
    <Modal label={t("search")} onClose={close} className="w-full max-w-[620px] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 shadow-[inset_0_-1px_0_var(--color-line)]">
        <Search size={20} strokeWidth={1.75} className="text-faint" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits[index] ? optionId(index) : undefined}
          aria-autocomplete="list"
          aria-label={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("searchPlaceholder")}
          className="no-ring h-12 w-full bg-transparent text-lg placeholder:text-faint"
        />
      </div>
      <div className="flex flex-wrap gap-1 px-3 pt-2 text-xs">
        {KINDS.map(([value, key]) => (
          <button
            key={key}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setIndex(0);
            }}
            className={`h-6 rounded-full px-2.5 ${kind === value ? "bg-active font-medium text-ink" : "text-muted hover:bg-hover"}`}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <div className="max-h-[50vh] min-h-16 overflow-y-auto p-1.5">
        {!query.trim() && hits.length > 0 && (
          <p className="px-2.5 pb-1 pt-1.5 text-xs text-muted">{t("recentPages")}</p>
        )}
        {query.trim() && !stale && hits.length === 0 && <p className="px-2.5 py-3 text-muted">{t("noResults")}</p>}
        <p role="status" className="sr-only">
          {query.trim() && !stale ? `${hits.length} ${t("nResults")}` : ""}
        </p>
        <div id={listId} role="listbox" aria-label={t("search")}>
          {hits.map((h, i) => (
            <div
              key={h.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === index}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={(e) => open(h.id, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => e.button === 1 && open(h.id, true)}
              className={`flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left ${i === index ? "bg-hover" : ""}`}
            >
              <span className="mt-0.5">
                <PageIcon page={h} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{h.title || t("untitled")}</span>
                {h.snippet && (
                  <span className="block truncate text-xs text-muted">
                    <Snippet text={h.snippet} />
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="whitespace-pre-wrap px-4 py-2 text-xs text-faint shadow-[inset_0_1px_0_var(--color-line)] max-sm:hidden">
        {t("searchHint")}
      </p>
    </Modal>
  );
}
