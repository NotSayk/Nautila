import {
  Bell,
  X,
  SquarePlus,
  Keyboard,
  Users,
  Cloud,
  CloudAlert,
  CloudOff,
  RefreshCw,
  CalendarCheck,
  CalendarDays,
  FileDown,
  ChevronRight,
  ChevronsLeft,
  Copy,
  CornerUpRight,
  Download,
  GraduationCap,
  Home,
  Languages,
  Layers,
  Moon,
  MoreHorizontal,
  Pencil,
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
import { duplicatePage, movePage, restorePage, trashPage, updatePageMeta, type PageMeta } from "../data/pages";
import { importFiles } from "../data/importer";
import { enableReminders } from "../reminders";
import { useT } from "../i18n";
import { useStore, type Route } from "../store";
import { moveToTrash } from "./actions";
import { IconButton, Menu, PageIcon } from "./common";
import { Pomodoro } from "./Pomodoro";
import { JoinDialog } from "./ShareDialog";

const ICON = { size: 18, strokeWidth: 1.75 } as const;
const ROW = "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left font-medium text-muted hover:bg-hover";
const ROW_ACTION = "grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-active";

function NavItem(props: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
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
      <span className="flex gap-0.5">{children}</span>
    </div>
  );
}

async function setFavorite(page: PageMeta, favorite: boolean) {
  await updatePageMeta(page.id, { favorite });
  await useStore.getState().refreshPages();
}

async function duplicate(page: PageMeta, suffix: string) {
  const copyId = await duplicatePage(page.id, suffix);
  await useStore.getState().refreshPages();
  await useStore.getState().refreshDue();
  useStore.getState().navigate({ view: "page", id: copyId });
}

type Zone = "before" | "inside" | "after";
type Drag = {
  dragId: string | null;
  target: { id: string; zone: Zone } | null;
  start: (id: string) => void;
  over: (id: string, zone: Zone) => void;
  end: (commit: boolean) => void;
};

function PageRow({
  page,
  depth,
  tree,
  open,
  onToggle,
  drag,
  selection,
}: {
  page: PageMeta;
  depth: number;
  /** Absent : ligne à plat, sans sous-pages (favoris). */
  tree?: Map<string | null, PageMeta[]>;
  open: Set<string>;
  onToggle: (id: string, force?: boolean) => void;
  drag?: Drag;
  /** Sélection multiple (Ctrl ou Maj + clic), dans l'arbre seulement. */
  selection?: { ids: Set<string>; toggle: (id: string) => void };
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const newPage = useStore((s) => s.newPage);
  const kids = tree?.get(page.id) ?? [];
  const active = route.view === "page" && route.id === page.id;
  const expanded = open.has(page.id);
  const zone = drag?.target?.id === page.id && drag.dragId !== page.id ? drag.target.zone : null;

  const rename = async (title: string) => {
    setRenaming(false);
    if (title === page.title) return;
    await updatePageMeta(page.id, { title });
    await useStore.getState().refreshPages();
  };

  return (
    <>
      <div
        draggable={!!drag && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", page.title);
          drag?.start(page.id);
        }}
        onDragOver={(e) => {
          if (!drag?.dragId) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - box.top) / box.height;
          drag.over(page.id, y < 0.25 ? "before" : y > 0.75 ? "after" : "inside");
        }}
        onDrop={(e) => {
          e.preventDefault();
          drag?.end(true);
        }}
        onDragEnd={() => drag?.end(false)}
        className={`group relative flex h-[30px] items-center rounded-md pr-1.5 font-medium hover:bg-hover ${
          selection?.ids.has(page.id) ? "bg-accent/15 text-ink" : active ? "bg-hover text-ink" : "text-muted"
        } ${zone === "inside" ? "bg-accent/15" : ""} ${drag?.dragId === page.id ? "opacity-40" : ""}`}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {(zone === "before" || zone === "after") && (
          <span
            className={`pointer-events-none absolute right-0 h-0.5 rounded bg-accent ${zone === "before" ? "-top-px" : "-bottom-px"}`}
            style={{ left: 6 + depth * 12 }}
          />
        )}
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
        {renaming ? (
          <span className="flex h-full min-w-0 flex-1 items-center gap-2">
            <PageIcon page={page} />
            <input
              autoFocus
              defaultValue={page.title}
              aria-label={t("rename")}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="h-6 min-w-0 flex-1 rounded bg-bg px-1 text-ink shadow-[0_0_0_1px_var(--color-accent)]"
            />
          </span>
        ) : (
          <button
            onClick={(e) => {
              if (selection && (e.ctrlKey || e.metaKey || e.shiftKey)) selection.toggle(page.id);
              else navigate({ view: "page", id: page.id });
            }}
            onAuxClick={(e) => e.button === 1 && useStore.getState().openTab({ view: "page", id: page.id })}
            onDoubleClick={() => setRenaming(true)}
            className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          >
            <PageIcon page={page} />
            <span className="truncate">{page.title || t("untitled")}</span>
          </button>
        )}
        <span className="hidden gap-0.5 group-focus-within:flex group-hover:flex">
          <Menu
            label={t("more")}
            className={ROW_ACTION}
            trigger={<MoreHorizontal size={14} />}
            items={[
              {
                icon: <SquarePlus size={16} />,
                label: t("openInTab"),
                onClick: () => useStore.getState().openTab({ view: "page", id: page.id }),
              },
              page.favorite
                ? { icon: <StarOff size={16} />, label: t("removeFavorite"), onClick: () => setFavorite(page, false) }
                : { icon: <Star size={16} />, label: t("addFavorite"), onClick: () => setFavorite(page, true) },
              { icon: <Pencil size={16} />, label: t("rename"), onClick: () => setRenaming(true) },
              { icon: <Copy size={16} />, label: t("duplicate"), onClick: () => duplicate(page, t("copySuffix")) },
              {
                icon: <CornerUpRight size={16} />,
                label: t("moveTo"),
                onClick: () => useStore.setState({ moveIds: [page.id] }),
              },
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
        kids.map((k) => (
          <PageRow
            key={k.id}
            page={k}
            depth={depth + 1}
            tree={tree}
            open={open}
            onToggle={onToggle}
            drag={drag}
            selection={selection}
          />
        ))}
    </>
  );
}

export function Sidebar() {
  const t = useT();
  const { route, pages, dueCount, dark, lang, sidebarOpen, sync } = useStore();
  const { navigate, newPage, toggleDark, setLang, setSearchOpen, setSidebarOpen } = useStore();
  // L'état déplié de l'arbre est mémorisé d'une session à l'autre.
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("nautila.tree") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("nautila.tree", JSON.stringify([...open]));
    } catch {
      /* préférence non mémorisée, sans gravité */
    }
  }, [open]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [joinOpen, setJoinOpen] = useState(false);

  const tree = useMemo(() => {
    const map = new Map<string | null, PageMeta[]>();
    const ids = new Set(pages.map((p) => p.id));
    const databases = new Set(pages.filter((p) => p.kind === "database").map((p) => p.id));
    for (const p of pages) {
      // Les lignes d'une base de données se consultent dans la base, pas dans l'arbre.
      if (p.parent_id && databases.has(p.parent_id)) continue;
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

  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<Drag["target"]>(null);
  const drag: Drag = {
    dragId,
    target,
    start: setDragId,
    over: (id, zone) => (target?.id !== id || target.zone !== zone) && setTarget({ id, zone }),
    end: async (commit) => {
      setDragId(null);
      setTarget(null);
      if (!commit || !dragId || !target || target.id === dragId) return;
      const dest = pages.find((p) => p.id === target.id);
      if (!dest) return;
      if (target.zone === "inside") {
        if (await movePage(dragId, dest.id)) toggle(dest.id, true);
      } else {
        // Position à mi-chemin entre la cible et sa voisine, du côté choisi.
        const siblings = (tree.get(dest.parent_id) ?? []).filter((p) => p.id !== dragId);
        const i = siblings.findIndex((p) => p.id === dest.id);
        const other = siblings[target.zone === "before" ? i - 1 : i + 1];
        const position = other
          ? (other.position + dest.position) / 2
          : dest.position + (target.zone === "before" ? -1 : 1);
        await movePage(dragId, dest.parent_id, position);
      }
      await useStore.getState().refreshPages();
    },
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selection = {
    ids: selected,
    toggle: (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
  };
  // Une page supprimée ou déplacée ailleurs sort de la sélection.
  const chosen = pages.filter((p) => selected.has(p.id));
  const trashSelected = async () => {
    for (const page of chosen) await trashPage(page.id);
    setSelected(new Set());
    await useStore.getState().refreshPages();
    await useStore.getState().refreshDue();
    if (route.view === "page" && selected.has(route.id)) navigate({ view: "home" });
    useStore.setState({
      toast: {
        message: `${chosen.length} × ${t("trashed").toLowerCase()}`,
        action: {
          label: t("undoAction"),
          run: async () => {
            for (const page of chosen) await restorePage(page.id);
            await useStore.getState().refreshPages();
            await useStore.getState().refreshDue();
          },
        },
      },
    });
  };

  const go = (r: Route) => () => navigate(r);
  const roots = tree.get(null) ?? [];
  const favorites = pages.filter((p) => p.favorite);

  const mdInput = useRef<HTMLInputElement>(null);
  const onImportMarkdown = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const { open, failed } = await importFiles(files);
    await useStore.getState().refreshPages();
    if (failed.length > 0) alert(`${t("importFailedFile")} ${failed.join(", ")}`);
    if (open) navigate({ view: "page", id: open });
  };

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
            label={t("syncTitle")}
            onClick={() => useStore.setState({ syncOpen: true })}
            className={`size-6 ${sync.status === "error" ? "text-danger" : ""}`}
          >
            {sync.status === "off" ? (
              <CloudOff size={16} strokeWidth={1.75} className="text-faint" />
            ) : sync.status === "syncing" ? (
              <RefreshCw size={15} strokeWidth={1.75} className="animate-spin" />
            ) : sync.status === "error" ? (
              <CloudAlert size={16} strokeWidth={1.75} />
            ) : (
              <Cloud size={16} strokeWidth={1.75} />
            )}
          </IconButton>
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
          <NavItem
            icon={<Home {...ICON} />}
            label={t("home")}
            active={route.view === "home"}
            onClick={go({ view: "home" })}
          />
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
          <NavItem
            icon={<CalendarDays {...ICON} />}
            label={t("timetable")}
            active={route.view === "timetable"}
            onClick={go({ view: "timetable" })}
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
            <PageRow
              key={p.id}
              page={p}
              depth={0}
              tree={tree}
              open={open}
              onToggle={toggle}
              drag={drag}
              selection={selection}
            />
          ))}
        </div>

        {chosen.length > 0 && (
          <div className="mx-1.5 mb-1 flex h-9 items-center gap-0.5 rounded-md bg-pop px-2 shadow-pop">
            <span className="flex-1 truncate font-medium">
              {chosen.length} {t("selected")}
            </span>
            <IconButton label={t("moveTo")} onClick={() => useStore.setState({ moveIds: chosen.map((p) => p.id) })}>
              <CornerUpRight size={15} />
            </IconButton>
            <IconButton label={t("moveToTrash")} onClick={trashSelected}>
              <Trash2 size={15} />
            </IconButton>
            <IconButton label={t("clearSelection")} onClick={() => setSelected(new Set())}>
              <X size={15} />
            </IconButton>
          </div>
        )}
        <div className="px-1.5 pb-2 pt-1 shadow-[inset_0_1px_0_var(--color-line)]">
          <Pomodoro />
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
              {
                icon: <Languages size={16} />,
                label: t("switchLang"),
                onClick: () => setLang(lang === "fr" ? "en" : "fr"),
              },
              "separator",
              {
                icon: <Download size={16} />,
                label: t("exportBackup"),
                onClick: async () =>
                  download(
                    `nautila-${new Date().toISOString().slice(0, 10)}.json`,
                    await exportBackup(),
                    "application/json",
                  ),
              },
              { icon: <Upload size={16} />, label: t("importBackup"), onClick: () => fileInput.current?.click() },
              { icon: <Users size={16} />, label: t("joinShared"), onClick: () => setJoinOpen(true) },
              { icon: <FileDown size={16} />, label: t("importDocs"), onClick: () => mdInput.current?.click() },
              "separator",
              {
                icon: <Keyboard size={16} />,
                label: t("shortcuts"),
                onClick: () => useStore.setState({ shortcutsOpen: true }),
              },
              {
                icon: <Bell size={16} />,
                label: t("enableReminders"),
                onClick: async () => alert(t((await enableReminders()) ? "remindersOn" : "remindersBlocked")),
              },
            ]}
          />
          <NavItem
            icon={<Trash2 {...ICON} />}
            label={t("trash")}
            active={route.view === "trash"}
            onClick={go({ view: "trash" })}
          />
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onImport} />
          <input
            ref={mdInput}
            type="file"
            accept=".md,.markdown,.txt,.docx,.zip,.pdf,text/markdown,text/plain,application/pdf"
            multiple
            hidden
            onChange={onImportMarkdown}
          />
        </div>
      </aside>
      {joinOpen && <JoinDialog onClose={() => setJoinOpen(false)} />}
    </>
  );
}
