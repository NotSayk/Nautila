import {
  CalendarCheck,
  ChevronRight,
  ChevronsLeft,
  Download,
  GraduationCap,
  Home,
  Languages,
  Layers,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { download, exportBackup, importBackup } from "../data/backup";
import { trashPage, updatePageMeta, type PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore, type Route } from "../store";
import { IconButton, Menu, PageIcon } from "./common";

const ICON = { size: 18, strokeWidth: 1.75 } as const;
const ROW = "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left font-medium text-muted hover:bg-hover";
const ROW_ACTION = "grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-active";

function NavItem(props: { icon: React.ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  return (
    <button onClick={props.onClick} className={`${ROW} ${props.active ? "bg-hover text-ink" : ""}`}>
      {props.icon}
      <span className="flex-1 truncate">{props.label}</span>
      {!!props.badge && <span className="text-xs tabular-nums text-faint">{props.badge}</span>}
    </button>
  );
}

function SectionHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="group mt-4 flex h-7 items-center justify-between px-2 text-xs font-medium text-faint">
      {label}
      <span className="flex gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        {children}
      </span>
    </div>
  );
}

async function moveToTrash(page: PageMeta) {
  const { route, navigate, refreshPages, refreshDue } = useStore.getState();
  await trashPage(page.id);
  await refreshPages();
  await refreshDue();
  if (route.view === "page" && route.id === page.id) navigate({ view: "home" });
}

async function setFavorite(page: PageMeta, favorite: boolean) {
  await updatePageMeta(page.id, { favorite });
  await useStore.getState().refreshPages();
}

function PageRow({
  page,
  depth,
  tree,
  open,
  onToggle,
}: {
  page: PageMeta;
  depth: number;
  /** Absent : ligne à plat, sans sous-pages (favoris). */
  tree?: Map<string | null, PageMeta[]>;
  open: Set<string>;
  onToggle: (id: string, force?: boolean) => void;
}) {
  const t = useT();
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const newPage = useStore((s) => s.newPage);
  const kids = tree?.get(page.id) ?? [];
  const active = route.view === "page" && route.id === page.id;
  const expanded = open.has(page.id);

  return (
    <>
      <div
        className={`group flex h-[30px] items-center rounded-md pr-1.5 font-medium hover:bg-hover ${
          active ? "bg-hover text-ink" : "text-muted"
        }`}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {tree && (
          <button
            aria-label="toggle"
            aria-expanded={expanded}
            onClick={() => onToggle(page.id)}
            className={`${ROW_ACTION} mr-0.5 ${kids.length ? "" : "invisible"}`}
          >
            <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        )}
        <button
          onClick={() => navigate({ view: "page", id: page.id })}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
        >
          <PageIcon page={page} />
          <span className="truncate">{page.title || t("untitled")}</span>
        </button>
        <span className="hidden gap-0.5 group-focus-within:flex group-hover:flex">
          <Menu
            label={t("more")}
            className={ROW_ACTION}
            trigger={<MoreHorizontal size={14} />}
            items={[
              page.favorite
                ? { icon: <StarOff size={16} />, label: t("removeFavorite"), onClick: () => setFavorite(page, false) }
                : { icon: <Star size={16} />, label: t("addFavorite"), onClick: () => setFavorite(page, true) },
              "separator",
              { icon: <Trash2 size={16} />, label: t("moveToTrash"), onClick: () => moveToTrash(page) },
            ]}
          />
          {tree && (
            <button
              title={page.kind === "semester" ? t("newCourse") : t("addInside")}
              aria-label={t("addInside")}
              onClick={async () => {
                onToggle(page.id, true);
                await newPage({ parentId: page.id, kind: page.kind === "semester" ? "course" : "note" });
              }}
              className={ROW_ACTION}
            >
              <Plus size={14} />
            </button>
          )}
        </span>
      </div>
      {expanded &&
        kids.map((k) => <PageRow key={k.id} page={k} depth={depth + 1} tree={tree} open={open} onToggle={onToggle} />)}
    </>
  );
}

export function Sidebar() {
  const t = useT();
  const { route, pages, dueCount, dark, lang, sidebarOpen } = useStore();
  const { navigate, newPage, toggleDark, setLang, setSearchOpen, setSidebarOpen } = useStore();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => {
    const map = new Map<string | null, PageMeta[]>();
    const ids = new Set(pages.map((p) => p.id));
    for (const p of pages) {
      const parent = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null;
      map.set(parent, [...(map.get(parent) ?? []), p]);
    }
    return map;
  }, [pages]);

  // Déplie les ancêtres de la page affichée.
  const currentId = route.view === "page" ? route.id : null;
  useEffect(() => {
    if (!currentId) return;
    const byId = new Map(pages.map((p) => [p.id, p]));
    setOpen((prev) => {
      const next = new Set(prev);
      for (let p = byId.get(currentId)?.parent_id; p; p = byId.get(p)?.parent_id) next.add(p);
      return next.size === prev.size ? prev : next;
    });
  }, [currentId, pages]);

  const toggle = (id: string, force?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const go = (r: Route) => () => navigate(r);
  const roots = tree.get(null) ?? [];
  const favorites = pages.filter((p) => p.favorite);

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !confirm(t("confirmImport"))) return;
    try {
      await importBackup(await file.text());
    } catch {
      alert(t("importFailed"));
    }
    await useStore.getState().refreshPages();
    await useStore.getState().refreshDue();
    navigate({ view: "home" });
  };

  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`group/side fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-panel shadow-[inset_-1px_0_0_var(--color-line)] transition-[translate,margin] duration-200 md:static ${
          sidebarOpen ? "" : "-translate-x-full md:-ml-60"
        }`}
      >
        <div className="flex h-11 items-center gap-2 px-3">
          <img src="/icon.svg" alt="" className="size-5 rounded" />
          <span className="flex-1 truncate font-semibold">Nautila</span>
          <IconButton
            label={t("closeSidebar")}
            onClick={() => setSidebarOpen(false)}
            className="size-6 opacity-0 focus:opacity-100 group-hover/side:opacity-100 max-md:opacity-100"
          >
            <ChevronsLeft size={18} strokeWidth={1.75} />
          </IconButton>
        </div>

        <nav className="px-1.5">
          <button onClick={() => setSearchOpen(true)} className={ROW}>
            <Search {...ICON} />
            <span className="flex-1">{t("search")}</span>
            <kbd className="font-sans text-xs text-faint">Ctrl K</kbd>
          </button>
          <NavItem icon={<Home {...ICON} />} label={t("home")} active={route.view === "home"} onClick={go({ view: "home" })} />
          <NavItem
            icon={<Layers {...ICON} />}
            label={t("review")}
            badge={dueCount}
            active={route.view === "review"}
            onClick={go({ view: "review" })}
          />
          <NavItem
            icon={<CalendarCheck {...ICON} />}
            label={t("tasks")}
            active={route.view === "tasks"}
            onClick={go({ view: "tasks" })}
          />
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
          {favorites.length > 0 && (
            <>
              <SectionHeader label={t("favorites")} />
              {favorites.map((p) => (
                <PageRow key={p.id} page={p} depth={0} open={open} onToggle={toggle} />
              ))}
            </>
          )}

          <SectionHeader label={t("pages")}>
            <button
              title={t("newSemester")}
              aria-label={t("newSemester")}
              onClick={() => newPage({ kind: "semester" })}
              className={ROW_ACTION}
            >
              <GraduationCap size={14} />
            </button>
            <button title={t("newPage")} aria-label={t("newPage")} onClick={() => newPage({})} className={ROW_ACTION}>
              <Plus size={14} />
            </button>
          </SectionHeader>
          {roots.length === 0 && <p className="px-2 py-1 text-[13px] leading-5 text-faint">{t("emptyTree")}</p>}
          {roots.map((p) => (
            <PageRow key={p.id} page={p} depth={0} tree={tree} open={open} onToggle={toggle} />
          ))}
        </div>

        <div className="px-1.5 pb-2 pt-1 shadow-[inset_0_1px_0_var(--color-line)]">
          <Menu
            label={t("settingsMenu")}
            className={ROW}
            trigger={
              <>
                <Settings {...ICON} />
                <span className="flex-1 truncate">{t("settingsMenu")}</span>
              </>
            }
            items={[
              { icon: <Moon size={16} />, label: t("darkTheme"), checked: dark, onClick: toggleDark },
              { icon: <Languages size={16} />, label: t("switchLang"), onClick: () => setLang(lang === "fr" ? "en" : "fr") },
              "separator",
              {
                icon: <Download size={16} />,
                label: t("exportBackup"),
                onClick: async () =>
                  download(`nautila-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), "application/json"),
              },
              { icon: <Upload size={16} />, label: t("importBackup"), onClick: () => fileInput.current?.click() },
            ]}
          />
          <NavItem icon={<Trash2 {...ICON} />} label={t("trash")} active={route.view === "trash"} onClick={go({ view: "trash" })} />
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onImport} />
        </div>
      </aside>
    </>
  );
}
