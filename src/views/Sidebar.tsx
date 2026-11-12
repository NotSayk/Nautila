import {
  CalendarCheck,
  ChevronRight,
  Download,
  GraduationCap,
  Home,
  Layers,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { download, exportBackup, importBackup } from "../data/backup";
import { trashPage, type PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore, type Route } from "../store";
import { PageIcon } from "./common";

function NavItem(props: { icon: React.ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover ${
        props.active ? "bg-hover font-medium" : ""
      }`}
    >
      {props.icon}
      <span className="flex-1 truncate">{props.label}</span>
      {!!props.badge && (
        <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-bg">{props.badge}</span>
      )}
    </button>
  );
}

function TreeRow({
  page,
  depth,
  tree,
  open,
  onToggle,
}: {
  page: PageMeta;
  depth: number;
  tree: Map<string | null, PageMeta[]>;
  open: Set<string>;
  onToggle: (id: string, force?: boolean) => void;
}) {
  const t = useT();
  const route = useStore((s) => s.route);
  const navigate = useStore((s) => s.navigate);
  const newPage = useStore((s) => s.newPage);
  const kids = tree.get(page.id) ?? [];
  const active = route.view === "page" && route.id === page.id;
  const expanded = open.has(page.id);

  return (
    <>
      <div
        className={`group flex items-center rounded-md pr-1 text-sm hover:bg-hover ${active ? "bg-hover font-medium" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          aria-label="toggle"
          onClick={() => onToggle(page.id)}
          className={`grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-line ${kids.length ? "" : "invisible"}`}
        >
          <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={() => navigate({ view: "page", id: page.id })}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
        >
          <PageIcon page={page} />
          <span className="truncate">{page.title || t("untitled")}</span>
        </button>
        <button
          title={t("moveToTrash")}
          aria-label={t("moveToTrash")}
          onClick={async () => {
            await trashPage(page.id);
            await useStore.getState().refreshPages();
            await useStore.getState().refreshDue();
            if (active) navigate({ view: "home" });
          }}
          className="hidden size-6 place-items-center rounded text-muted hover:bg-line group-hover:grid"
        >
          <Trash2 size={14} />
        </button>
        <button
          title={page.kind === "semester" ? t("newCourse") : t("addInside")}
          aria-label={t("addInside")}
          onClick={async () => {
            onToggle(page.id, true);
            await newPage({ parentId: page.id, kind: page.kind === "semester" ? "course" : "note" });
          }}
          className="hidden size-6 place-items-center rounded text-muted hover:bg-line group-hover:grid"
        >
          <Plus size={14} />
        </button>
      </div>
      {expanded &&
        kids.map((k) => (
          <TreeRow key={k.id} page={k} depth={depth + 1} tree={tree} open={open} onToggle={onToggle} />
        ))}
    </>
  );
}

export function Sidebar() {
  const t = useT();
  const { route, pages, dueCount, dark, lang } = useStore();
  const { navigate, newPage, toggleDark, setLang, setSearchOpen } = useStore();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const children = useMemo(() => {
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

  useEffect(() => setMobileOpen(false), [route]);

  const toggle = (id: string, force?: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const go = (r: Route) => () => navigate(r);
  const roots = children.get(null) ?? [];

  return (
    <>
      <button
        aria-label="menu"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-20 grid size-9 place-items-center rounded-md border border-line bg-bg md:hidden"
      >
        <Menu size={18} />
      </button>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-line bg-panel transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <img src="/icon.svg" alt="" className="size-6 rounded-md" />
          <span className="font-semibold">Nautila</span>
        </div>

        <nav className="space-y-0.5 px-2">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover"
          >
            <Search size={16} />
            <span className="flex-1">{t("search")}</span>
            <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
          </button>
          <NavItem icon={<Home size={16} />} label={t("home")} active={route.view === "home"} onClick={go({ view: "home" })} />
          <NavItem
            icon={<Layers size={16} />}
            label={t("review")}
            badge={dueCount}
            active={route.view === "review"}
            onClick={go({ view: "review" })}
          />
          <NavItem
            icon={<CalendarCheck size={16} />}
            label={t("tasks")}
            active={route.view === "tasks"}
            onClick={go({ view: "tasks" })}
          />
        </nav>

        <div className="mt-4 flex items-center justify-between px-4 text-xs font-semibold uppercase tracking-wide text-muted">
          {t("pages")}
          <span className="flex gap-1">
            <button
              title={t("newSemester")}
              aria-label={t("newSemester")}
              onClick={() => newPage({ kind: "semester" })}
              className="grid size-6 place-items-center rounded hover:bg-hover"
            >
              <GraduationCap size={14} />
            </button>
            <button
              title={t("newPage")}
              aria-label={t("newPage")}
              onClick={() => newPage({})}
              className="grid size-6 place-items-center rounded hover:bg-hover"
            >
              <Plus size={14} />
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {roots.length === 0 && <p className="px-2 py-2 text-sm text-muted">{t("emptyTree")}</p>}
          {roots.map((p) => (
            <TreeRow key={p.id} page={p} depth={0} tree={children} open={open} onToggle={toggle} />
          ))}
        </div>

        <div className="space-y-0.5 border-t border-line p-2">
          <NavItem icon={<Trash2 size={16} />} label={t("trash")} active={route.view === "trash"} onClick={go({ view: "trash" })} />
          <NavItem
            icon={<Download size={16} />}
            label={t("exportBackup")}
            onClick={async () =>
              download(`nautila-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), "application/json")
            }
          />
          <NavItem icon={<Upload size={16} />} label={t("importBackup")} onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
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
            }}
          />
          <div className="flex items-center gap-1 px-1 pt-1">
            <button
              title={t("theme")}
              aria-label={t("theme")}
              onClick={toggleDark}
              className="grid size-8 place-items-center rounded-md hover:bg-hover"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="rounded-md px-2 py-1 text-xs font-semibold hover:bg-hover"
            >
              {lang === "fr" ? "FR" : "EN"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
