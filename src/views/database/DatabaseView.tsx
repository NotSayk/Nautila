import {
  ArrowUpDown,
  CalendarDays,
  Columns3,
  Copy,
  Download,
  GanttChart,
  Layers,
  LayoutGrid,
  List,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { download } from "../../data/backup";
import { parseCsv } from "../../data/csv";
import { exportTable, planImport, toCsv } from "../../data/dbcsv";
import { rollupTargets, withComputed, type RelatedBase } from "../../data/dbcalc";
import { convertColumn, convertTargets } from "../../data/dbconvert";
import {
  addMirror,
  createRow,
  createRows,
  duplicateRow,
  fileInfos,
  getDatabase,
  listRows,
  loadRelated,
  newView,
  purgeOptions,
  restoreValues,
  saveDatabase,
  setRowPosition,
  setRowProps,
  syncTwin,
  unlinkTwin,
  updateRows,
} from "../../data/databases";
import { weekStartFor } from "../../data/dbdate";
import { GROUPABLE, groupRows, type Group } from "../../data/dbgroup";
import {
  applyView,
  isComputed,
  isEmpty,
  positionBefore,
  removeProp,
  searchRows,
  storedValues,
  viewSorts,
  visibleProps,
  type DbConfig,
  type DbView,
  type Option,
  type Prop,
  type Row,
  type Value,
  type ViewType,
} from "../../data/dbquery";
import { countFilters, duplicateProp, duplicateView, presetFromFilters } from "../../data/dbview";
import { restorePage, trashPage, updatePageMeta, type PageMeta } from "../../data/pages";
import { useT, type Key } from "../../i18n";
import { useStore } from "../../store";
import { Menu } from "../common";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { ListView } from "./ListView";
import { RowPeek } from "./RowPeek";
import { TableView } from "./TableView";
import { TimelineView } from "./TimelineView";
import { FilterEditor, GroupEditor, PopButton, PropertiesEditor, SortEditor } from "./Toolbar";
import { LINE, uid, type Api } from "./shared";

export { RowProperties } from "./RowProperties";

const VIEW_TYPES: [ViewType, Key, typeof Table2][] = [
  ["table", "viewTable", Table2],
  ["board", "viewBoard", Columns3],
  ["calendar", "viewCalendar", CalendarDays],
  ["list", "viewList", List],
  ["gallery", "viewGallery", LayoutGrid],
  ["timeline", "viewTimeline", GanttChart],
];

/** Message de retour avec une action pour annuler pendant quelques secondes. */
const toastUndo = (message: string, label: string, run: () => void | Promise<void>) =>
  useStore.setState({ toast: { message, action: { label, run } } });

export function DatabaseView({ page, embedded }: { page: PageMeta; embedded?: boolean }) {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  const lang = useStore((s) => s.lang);
  const pages = useStore((s) => s.pages);
  const [config, setConfigState] = useState<DbConfig | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [related, setRelated] = useState<Map<string, RelatedBase>>(new Map());
  const [viewId, setViewId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [selected, setSelectedState] = useState<Set<string>>(new Set());
  const [filterSignal, setFilterSignal] = useState(0);

  const configRef = useRef<DbConfig | null>(null);
  const rowsRef = useRef<Row[]>([]);
  const loadSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const putRows = useCallback((next: Row[] | ((list: Row[]) => Row[])) => {
    rowsRef.current = typeof next === "function" ? next(rowsRef.current) : next;
    setRows(rowsRef.current);
  }, []);

  // Une réponse tardive d'un chargement précédent est ignorée.
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    const list = await listRows(page.id);
    if (seq === loadSeq.current) putRows(list);
  }, [page.id, putRows]);

  // La liste des pages change (synchro, partage, autre onglet) : on relit les lignes.
  const firstPages = useRef(true);
  useEffect(() => {
    if (firstPages.current) {
      firstPages.current = false;
      return;
    }
    if (configRef.current) void reload();
  }, [pages, reload]);

  useEffect(() => {
    let live = true;
    configRef.current = null;
    setPeekId(null);
    setSelectedState(new Set());
    setQuery("");
    (async () => {
      let loaded = await getDatabase(page.id);
      if (!loaded) {
        loaded = { props: [], views: [newView("table", t("viewTable"))] };
        await saveDatabase(page.id, loaded);
      }
      const seq = ++loadSeq.current;
      const list = await listRows(page.id);
      if (!live) return;
      configRef.current = loaded;
      setConfigState(loaded);
      if (seq === loadSeq.current) putRows(list);
    })();
    return () => {
      live = false;
    };
    // `t` change avec la langue mais ne sert qu'au nom de la vue initiale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const setConfig = useCallback(
    (update: (c: DbConfig) => DbConfig) => {
      const current = configRef.current;
      if (!current) return;
      const next = update(current);
      configRef.current = next;
      setConfigState(next);
      void saveDatabase(page.id, next);
    },
    [page.id],
  );
  const clearFresh = useCallback(() => setFresh(null), []);

  // Les lignes des bases liées par un cumul.
  const targets = config ? rollupTargets(config.props).join(",") : "";
  useEffect(() => {
    let live = true;
    if (!targets) setRelated((m) => (m.size ? new Map() : m));
    else void loadRelated(targets.split(",")).then((m) => live && setRelated(m));
    return () => {
      live = false;
    };
  }, [targets, pages, rows]);

  const view = config?.views.find((v) => v.id === viewId) ?? config?.views[0];
  const ctx = useMemo(() => ({ weekStart: weekStartFor(lang) }), [lang]);
  const computed = useMemo(() => (config ? withComputed(rows, config.props, related) : []), [rows, config, related]);
  const visible = useMemo(
    () => (config && view ? searchRows(applyView(computed, view, config.props, ctx), query, config.props) : []),
    [computed, view, config, ctx, query],
  );
  const titleOf = useCallback((id: string) => pages.find((p) => p.id === id)?.title ?? null, [pages]);

  const groupProp = config?.props.find((p) => p.id === view?.groupBy && GROUPABLE.includes(p.type));
  const groups = useMemo<Group[] | null>(
    () =>
      groupProp && view
        ? groupRows(visible, groupProp, {
            by: view.groupDate,
            weekStart: ctx.weekStart,
            keepEmpty: view.type === "board" && !view.hideEmptyGroups,
            noneFirst: view.type === "board",
            titleOf,
          })
        : null,
    [visible, groupProp, view, ctx, titleOf],
  );

  // La sélection ne garde que les lignes qui existent encore.
  useEffect(() => {
    setSelectedState((s) => {
      const alive = new Set([...s].filter((id) => rows.some((r) => r.id === id)));
      return alive.size === s.size ? s : alive;
    });
  }, [rows]);

  if (!config || !view) return null;

  const refreshPages = () => useStore.getState().refreshPages();
  const patchView = (patch: Partial<DbView>) =>
    setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) }));
  const hasSort = viewSorts(view).some((s) => s.prop === "title" || config.props.some((p) => p.id === s.prop));
  const rawRow = (id: string) => rowsRef.current.find((r) => r.id === id);

  const trash = async (ids: string[]) => {
    for (const id of ids) await trashPage(id);
    setSelectedState(new Set());
    await reload();
    await refreshPages();
    toastUndo(t("rowsTrashed"), t("undoAction"), async () => {
      for (const id of ids) await restorePage(id);
      await reload();
      await refreshPages();
    });
  };

  const setValues = async (row: Row, patch: Record<string, Value>) => {
    // On repart de la ligne brute : `row` peut porter des résultats calculés qu'on ne stocke pas.
    const raw = rawRow(row.id) ?? row;
    const props = storedValues({ ...raw.props, ...patch }, config.props);
    putRows((list) => list.map((r) => (r.id === row.id ? { ...r, props, updated_at: Date.now() } : r)));
    await setRowProps(row.id, props);
    // Relations bidirectionnelles : le miroir des lignes liées suit.
    let mirrored = false;
    for (const p of config.props)
      if (p.type === "relation" && p.twin && p.id in patch) {
        await syncTwin(row.id, p, raw.props[p.id], patch[p.id]);
        mirrored ||= p.target === page.id;
      }
    if (mirrored) await reload();
  };

  const api: Api = {
    databaseId: page.id,
    props: config.props,
    shown: visibleProps(config.props, view),
    rows: visible,
    groups,
    groupProp,
    view,
    related,
    ctx,
    lang,
    canReorder: !hasSort && !groupProp && !query.trim(),
    fresh,
    clearFresh,
    peek: setPeekId,
    openPage: (id) => navigate({ view: "page", id }),
    patchView,
    setConfig,
    titleOf,
    rowById: (id) => computed.find((r) => r.id === id),
    selected,
    toggleSelected: (id) =>
      setSelectedState((s) => {
        const next = new Set(s);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    setSelected: (ids) => setSelectedState(new Set(ids)),
    openFilters: () => setFilterSignal((n) => n + 1),
    add: async (props = {}) => {
      // Une ligne créée sous des filtres reçoit leurs valeurs, pour rester visible.
      const id = await createRow(page.id, {
        ...presetFromFilters(view.filters, view.filterMode, config.props),
        ...props,
      });
      setFresh(id);
      await reload();
      await refreshPages();
    },
    remove: (id) => trash([id]),
    removeMany: trash,
    duplicate: async (id) => {
      const at = visible.findIndex((r) => r.id === id);
      const original = visible[at];
      if (!original) return;
      // La copie vient juste après l'original dans l'ordre manuel.
      const next = visible[at + 1];
      const position = next ? (original.position + next.position) / 2 : original.position + 1;
      const copy = await duplicateRow(id, ` (${t("propCopy")})`, position);
      for (const p of config.props)
        if (p.type === "relation" && p.twin) await syncTwin(copy, p, null, original.props[p.id]);
      await reload();
      await refreshPages();
      setFresh(copy);
      useStore.setState({ toast: { message: t("rowDuplicated") } });
    },
    moveRow: async (id, beforeId) => {
      const position = positionBefore(visible, id, beforeId);
      if (position === null) return;
      putRows((list) => list.map((r) => (r.id === id ? { ...r, position } : r)));
      await setRowPosition(id, position);
    },
    setTitle: async (id, title) => {
      await updatePageMeta(id, { title });
      await reload();
      await refreshPages();
    },
    setValue: (row, propId, value) => setValues(row, { [propId]: value }),
    setValues,
    setOptions: (propId, options: Option[]) => {
      const before = config.props.find((p) => p.id === propId)?.options ?? [];
      const removed = before.filter((o) => !options.some((x) => x.id === o.id)).map((o) => o.id);
      setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === propId ? { ...p, options } : p)) }));
      // Une option supprimée disparaît de toutes les lignes, pas seulement de la cellule courante.
      if (removed.length)
        void purgeOptions(page.id, propId, removed).then((changed) => {
          if (changed.length) putRows((list) => list.map((r) => changed.find((c) => c.id === r.id) ?? r));
        });
    },
    updateProp: (propId, patch) =>
      setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === propId ? { ...p, ...patch } : p)) })),
    convertProp: async (propId, to) => {
      const old = configRef.current?.props.find((p) => p.id === propId);
      if (!old || old.type === to) return;
      const cells = computed.map((r) => ({ id: r.id, value: r.props[propId] }));
      const had = cells.some((c) => !isEmpty(c.value));
      let next: Prop;
      let values = new Map<string, Value>();
      if (!had && !convertTargets(old.type).includes(to)) {
        // Colonne vide : le type change sans rien à convertir.
        next = { id: old.id, name: old.name, type: to, ...(to === "relation" ? { target: page.id } : {}) };
      } else ({ prop: next, values } = convertColumn(cells, old, to));
      setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === propId ? next : p)) }));
      if (values.size && !isComputed(to)) {
        const changed = await updateRows(page.id, (props, row) =>
          values.has(row.id) ? { ...props, [propId]: values.get(row.id) } : null,
        );
        putRows((list) => list.map((r) => changed.find((c) => c.id === r.id) ?? r));
      }
      // Annuler remet l'ancienne propriété et les valeurs d'avant (rien à remettre pour un type calculé).
      const before = new Map(cells.map((c) => [c.id, isComputed(old.type) ? undefined : c.value]));
      toastUndo(t("typeChanged"), t("undoAction"), async () => {
        setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === propId ? old : p)) }));
        const restored = await restoreValues(page.id, propId, before);
        putRows((list) => list.map((r) => restored.find((c) => c.id === r.id) ?? r));
      });
    },
    duplicateProp: async (propId) => {
      const old = configRef.current?.props.find((p) => p.id === propId);
      if (!old) return;
      const id = uid();
      setConfig((c) => duplicateProp(c, propId, id, `${old.name} (${t("propCopy")})`));
      if (isComputed(old.type)) return;
      const changed = await updateRows(page.id, (props) =>
        isEmpty(props[propId]) ? null : { ...props, [id]: props[propId] },
      );
      putRows((list) => list.map((r) => changed.find((c) => c.id === r.id) ?? r));
    },
    deleteProp: (propId) => {
      const snapshot = configRef.current;
      const old = snapshot?.props.find((p) => p.id === propId);
      if (!snapshot || !old) return;
      setConfig((c) => removeProp(c, propId));
      if (old.twin && old.target && old.target !== page.id) void unlinkTwin(old.target, old.twin);
      // Annuler rend la propriété et ses réglages ; une relation bidirectionnelle revient simple.
      const { twin: _twin, ...restored } = old;
      toastUndo(t("propDeleted"), t("undoAction"), () =>
        setConfig(() => ({
          ...snapshot,
          props: snapshot.props
            .filter((p) => !(old.twin && p.id === old.twin && old.target === page.id))
            .map((p) => (p.id === propId ? restored : p)),
        })),
      );
    },
    setTwin: async (propId, on) => {
      const current = configRef.current;
      const prop = current?.props.find((p) => p.id === propId);
      if (!current || !prop) return;
      if (on) {
        const next = await addMirror(page.id, current, propId, page.title || t("database"));
        setConfig(() => next);
        await reload();
        return;
      }
      const { twin, target } = prop;
      setConfig((c) => ({
        ...c,
        props: c.props.map((p) => {
          if (p.id !== propId && !(target === page.id && p.id === twin)) return p;
          const { twin: _gone, ...rest } = p;
          return rest;
        }),
      }));
      if (twin && target && target !== page.id) await unlinkTwin(target, twin);
    },
  };

  const addView = (type: ViewType, name: string) => {
    const next = newView(type, name);
    setConfig((c) => {
      let props = c.props;
      // Un kanban a besoin d'une sélection, un calendrier d'une date : on les crée au besoin.
      if (type === "board") {
        let group = props.find((p) => p.type === "select");
        if (!group) {
          group = {
            id: uid(),
            name: t("status"),
            type: "select",
            options: [
              { id: uid(), name: t("statusTodo"), color: "gray" },
              { id: uid(), name: t("statusDoing"), color: "blue" },
              { id: uid(), name: t("statusDone"), color: "green" },
            ],
          };
          props = [...props, group];
        }
        next.groupBy = group.id;
      }
      if (type === "calendar" || type === "timeline") {
        let date = props.find((p) => p.type === "date");
        if (!date) {
          date = { id: uid(), name: t("propDate"), type: "date" };
          props = [...props, date];
        }
        next.dateProp = date.id;
      }
      return { props, views: [...c.views, next] };
    });
    setViewId(next.id);
  };

  const copyView = () => {
    const copy = duplicateView(view, uid(), `${view.name} (${t("propCopy")})`, uid);
    setConfig((c) => {
      const at = c.views.findIndex((v) => v.id === view.id);
      const views = [...c.views];
      views.splice(at + 1, 0, copy);
      return { ...c, views };
    });
    setViewId(copy.id);
  };
  const deleteView = () => {
    const snapshot = config.views;
    const gone = view;
    setViewId(null);
    setConfig((c) => ({ ...c, views: c.views.filter((v) => v.id !== gone.id) }));
    toastUndo(t("viewDeleted"), t("undoAction"), () => {
      setConfig((c) => {
        if (c.views.some((v) => v.id === gone.id)) return c;
        const at = snapshot.findIndex((v) => v.id === gone.id);
        const views = [...c.views];
        views.splice(Math.min(at, views.length), 0, gone);
        return { ...c, views };
      });
      setViewId(gone.id);
    });
  };

  /** Écrit les lignes visibles de la vue (filtres, tri et recherche compris) et ses propriétés affichées. */
  const exportCsv = async () => {
    const shown = visibleProps(config.props, view);
    const urls = shown
      .filter((p) => p.type === "files")
      .flatMap((p) => visible.flatMap((r) => (Array.isArray(r.props[p.id]) ? (r.props[p.id] as string[]) : [])));
    const infos = await fileInfos(urls);
    const table = exportTable(shown, visible, {
      labels: { title: t("name"), yes: t("csvYes"), no: t("csvNo") },
      titleOf,
      fileName: (url) => infos.get(url)?.name ?? null,
    });
    const name = (page.title || t("database")).replace(/[\\/:*?"<>|]+/g, "_");
    download(`${name}.csv`, toCsv(table), "text/csv;charset=utf-8");
  };

  /** Ajoute les lignes d'un fichier CSV à la base ; les colonnes inconnues deviennent des propriétés. */
  const importCsv = async (file: File) => {
    const say = (message: string) => useStore.setState({ toast: { message } });
    try {
      const plan = planImport(parseCsv(await file.text()), configRef.current?.props ?? config.props, uid);
      if (!plan) return say(t("csvEmpty"));
      setConfig((c) => ({ ...c, props: plan.props }));
      const ids = await createRows(page.id, plan.items);
      await reload();
      await refreshPages();
      const skipped = plan.skipped.length ? ` · ${plan.skipped.length} ${t("csvSkipped")}` : "";
      toastUndo(`${ids.length} ${t("csvImported")}${skipped}`, t("undoAction"), async () => {
        for (const id of ids) await trashPage(id);
        await reload();
        await refreshPages();
      });
    } catch {
      say(t("csvError"));
    }
  };

  // Type de vue inconnu (base plus récente, import) : repli sur le tableau.
  const layout: ViewType = VIEW_TYPES.some(([type]) => type === view.type) ? view.type : "table";
  const dated = layout === "calendar" || layout === "timeline";
  const filterCount = countFilters(view.filters);
  const dateSelect = (key: "dateProp" | "endProp") => {
    // Une propriété supprimée n'est plus sélectionnée : le sélecteur reflète l'état réel.
    const current = config.props.some((p) => p.id === view[key] && p.type === "date") ? (view[key] as string) : "";
    return (
      <select
        key={key}
        aria-label={t(key === "endProp" ? "endDate" : "propDate")}
        value={current}
        onChange={(e) => patchView({ [key]: e.target.value || undefined })}
        className="h-7 max-w-36 rounded-md bg-transparent px-1 text-muted hover:bg-hover"
      >
        {key === "dateProp" && !current && <option value="">{t("chooseProp")}</option>}
        {key === "endProp" && (
          <option value="">
            {t("endDate")} : {t("none").toLowerCase()}
          </option>
        )}
        {config.props
          .filter((p) => p.type === "date")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    );
  };

  return (
    <div className={embedded ? "" : "px-(--page-pad) pb-32 pt-4"}>
      <div className={`mb-3 flex flex-wrap items-center gap-x-1 gap-y-2 ${LINE}`}>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden max-md:basis-full">
          {config.views.map((v) => {
            const Icon = VIEW_TYPES.find(([type]) => type === v.type)?.[2] ?? Table2;
            const active = v.id === view.id;
            return renaming === v.id ? (
              <input
                key={v.id}
                autoFocus
                defaultValue={v.name}
                aria-label={t("name")}
                onBlur={(e) => {
                  setRenaming(null);
                  if (e.target.value.trim()) patchView({ name: e.target.value.trim() });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.value = v.name;
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
                className="mb-1 h-7 w-32 rounded bg-hover px-2"
              />
            ) : (
              <span key={v.id} className="flex shrink-0 items-center">
                <button
                  onClick={() => setViewId(v.id)}
                  onDoubleClick={() => setRenaming(v.id)}
                  aria-current={active ? "true" : undefined}
                  className={`flex h-9 shrink-0 items-center gap-1.5 border-b-2 pl-2 ${active ? "pr-1" : "pr-2"} font-medium ${
                    active ? "border-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  {v.name}
                </button>
                {active && (
                  <Menu
                    label={t("viewMenu")}
                    className="mr-1 grid size-6 place-items-center rounded text-muted hover:bg-hover"
                    trigger={<MoreHorizontal size={14} />}
                    items={[
                      { icon: <Pencil size={16} />, label: t("renameView"), onClick: () => setRenaming(v.id) },
                      { icon: <Copy size={16} />, label: t("duplicateView"), onClick: copyView },
                      ...(config.views.length > 1
                        ? [
                            "separator" as const,
                            {
                              icon: <Trash2 size={16} />,
                              label: t("deleteView"),
                              danger: true,
                              onClick: deleteView,
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </span>
            );
          })}
          <Menu
            label={t("addView")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover"
            trigger={<Plus size={15} />}
            items={VIEW_TYPES.map(([type, key, Icon]) => ({
              icon: <Icon size={16} />,
              label: t(key),
              onClick: () => addView(type, t(key)),
            }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-0.5 pb-1">
          {dated && dateSelect("dateProp")}
          {dated && dateSelect("endProp")}
          <label className="relative flex h-7 items-center">
            <Search size={14} className="pointer-events-none absolute left-2 text-faint" />
            <input
              type="search"
              aria-label={t("searchView")}
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              className="h-7 w-28 rounded-md bg-transparent pl-7 pr-1 placeholder:text-faint hover:bg-hover focus:w-44 focus:bg-hover max-sm:w-24 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                aria-label={t("clearSearch")}
                title={t("clearSearch")}
                onClick={() => setQuery("")}
                className="absolute right-1 grid size-5 place-items-center rounded text-muted hover:bg-active"
              >
                <X size={12} />
              </button>
            )}
          </label>
          <PopButton
            label={filterCount ? `${t("filter")} · ${filterCount}` : t("filter")}
            icon={<ListFilter size={15} />}
            active={filterCount > 0}
            width={460}
            signal={filterSignal}
          >
            <FilterEditor api={api} />
          </PopButton>
          <PopButton label={t("sort")} icon={<ArrowUpDown size={15} />} active={hasSort} width={380}>
            <SortEditor api={api} />
          </PopButton>
          {!dated && (
            <PopButton label={t("group")} icon={<Layers size={15} />} active={!!groupProp} width={280}>
              <GroupEditor api={api} />
            </PopButton>
          )}
          {!dated && (
            <PopButton
              label={t("properties")}
              icon={<SlidersHorizontal size={15} />}
              active={(view.hidden?.length ?? 0) > 0}
              width={300}
            >
              <PropertiesEditor api={api} />
            </PopButton>
          )}
          <Menu
            label={t("moreActions")}
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover"
            trigger={<MoreHorizontal size={15} />}
            align="right"
            items={[
              { icon: <Download size={16} />, label: t("exportCsv"), onClick: () => void exportCsv() },
              { icon: <Upload size={16} />, label: t("importCsv"), onClick: () => fileInput.current?.click() },
            ]}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label={t("importCsv")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importCsv(file);
            }}
          />
          <button
            onClick={() => api.add()}
            className="ml-1 h-7 rounded-md bg-accent px-2.5 font-medium text-white hover:brightness-95"
          >
            {t("newRow")}
          </button>
        </div>
      </div>

      {layout === "table" && <TableView api={api} />}
      {layout === "board" && <BoardView api={api} />}
      {layout === "calendar" && <CalendarView api={api} />}
      {layout === "list" && <ListView api={api} />}
      {layout === "gallery" && <GalleryView api={api} />}
      {layout === "timeline" && <TimelineView api={api} />}
      {visible.length === 0 && rows.length > 0 && <p className="py-6 text-center text-muted">{t("emptyDb")}</p>}

      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={`${selected.size} ${t("selectedRows")}`}
          className="fixed bottom-4 left-1/2 z-30 flex h-10 -translate-x-1/2 items-center gap-1 rounded-lg bg-pop px-2 text-sm shadow-pop"
        >
          <span className="px-2">
            {selected.size} {t("selectedRows")}
          </span>
          <button
            onClick={() => void api.removeMany([...selected])}
            className="flex h-7 items-center gap-1.5 rounded px-2 text-danger hover:bg-hover"
          >
            <Trash2 size={14} />
            {t("deleteSelected")}
          </button>
          <button onClick={() => setSelectedState(new Set())} className="h-7 rounded px-2 text-muted hover:bg-hover">
            {t("clearSelection")}
          </button>
        </div>
      )}
      {peekId && <RowPeek api={api} rowId={peekId} onClose={() => setPeekId(null)} />}
    </div>
  );
}
