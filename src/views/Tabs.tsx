import { CalendarDays, CheckSquare, Home, Layers, Plus, Trash2, Users, X } from "lucide-react";
import { useT, type Key } from "../i18n";
import { useStore, type Route } from "../store";
import { PageIcon } from "./common";

const VIEWS: Record<Exclude<Route["view"], "page">, [Key, React.ReactNode]> = {
  home: ["home", <Home size={15} />],
  review: ["review", <Layers size={15} />],
  tasks: ["tasks", <CheckSquare size={15} />],
  trash: ["trash", <Trash2 size={15} />],
  timetable: ["timetable", <CalendarDays size={15} />],
  join: ["joinShared", <Users size={15} />],
  view: ["publicView", <Users size={15} />],
};

/** Barre d'onglets : affichée dès qu'il y en a deux. */
export function Tabs() {
  const t = useT();
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.tab);
  const pages = useStore((s) => s.pages);
  const { selectTab, closeTab, openTab } = useStore.getState();
  if (tabs.length < 2) return null;

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto bg-panel px-2 shadow-[inset_0_-1px_0_var(--color-line)]">
      <nav aria-label={t("tabs")} className="flex min-w-0 items-end gap-0.5">
        {tabs.map((route, i) => {
          const page = route.view === "page" ? pages.find((p) => p.id === route.id) : undefined;
          const title = route.view === "page" ? page?.title || t("untitled") : t(VIEWS[route.view][0]);
          const selected = i === active;
          return (
            <div
              key={i}
              className={`group flex h-8 min-w-0 max-w-[200px] items-center rounded-t-md pr-1 ${
                selected ? "bg-bg text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-hover"
              }`}
              onAuxClick={(e) => e.button === 1 && closeTab(i)}
            >
              <button
                data-tab
                aria-current={selected ? "page" : undefined}
                onClick={() => selectTab(i)}
                onKeyDown={(e) => {
                  const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!move) return;
                  const next = (i + move + tabs.length) % tabs.length;
                  selectTab(next);
                  (e.currentTarget.closest("nav")?.querySelectorAll("[data-tab]")[next] as HTMLElement)?.focus();
                }}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-1 text-left text-[13px]"
              >
                <span className="grid shrink-0 place-items-center">
                  {page ? <PageIcon page={page} size={15} /> : route.view !== "page" && VIEWS[route.view][1]}
                </span>
                <span className="truncate">{title}</span>
              </button>
              <button
                aria-label={`${t("closeTab")} : ${title}`}
                title={t("closeTab")}
                onClick={() => closeTab(i)}
                className={`grid size-5 shrink-0 place-items-center rounded hover:bg-hover ${
                  selected ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                }`}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </nav>
      <button
        aria-label={t("newTab")}
        title={t("newTab")}
        onClick={() => openTab()}
        className="mb-1 grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-hover"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
