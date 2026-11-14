import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { calcFnsFor, computeCalc, formatNumber } from "../../data/dbcalc";
import { formatDateValue } from "../../data/dbdate";
import type { CalcFn, Prop, Row, Value } from "../../data/dbquery";
import { viewSorts } from "../../data/dbquery";
import { moveProp } from "../../data/dbview";
import { useT, type Key } from "../../i18n";
import { Menu, PageIcon } from "../common";
import { ColumnMenu } from "./ColumnMenu";
import { PropEditor } from "./Cells";
import { AddRow, GroupHeader, groupPreset, isCollapsed, RowMenu, TitleInput } from "./Parts";
import { LINE, PROP_TYPES, REVEAL, typeLabel, uid, type Api } from "./shared";

const TITLE_WIDTH = 280;
const PROP_WIDTH = 180;
const MIN_WIDTH = 80;
const MAX_WIDTH = 800;
const GUTTER = 56;
const END = 40;
const clamp = (w: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));

const CALC_LABELS: Record<CalcFn, Key> = {
  count: "calcCount",
  values: "calcValues",
  unique: "calcUnique",
  empty: "calcEmpty",
  not_empty: "calcNotEmpty",
  pct_empty: "calcPctEmpty",
  pct_not_empty: "calcPctNotEmpty",
  sum: "calcSum",
  avg: "calcAvg",
  median: "calcMedian",
  min: "calcMin",
  max: "calcMax",
  range: "calcRange",
  earliest: "calcEarliest",
  latest: "calcLatest",
  checked: "calcChecked",
  unchecked: "calcUnchecked",
  pct_checked: "calcPctChecked",
};

/** Poignée qui redimensionne une colonne à la souris, au toucher ou aux flèches. */
function ResizeHandle({
  label,
  width,
  onLive,
  onCommit,
  onReset,
}: {
  label: string;
  width: number;
  onLive: (w: number | null) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title={label}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        last.current = width;
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        last.current = clamp(start.current.w + e.clientX - start.current.x);
        onLive(last.current);
      }}
      onPointerUp={() => {
        const from = start.current;
        if (!from) return;
        start.current = null;
        onLive(null);
        if (last.current !== from.w) onCommit(last.current);
      }}
      onPointerCancel={() => {
        start.current = null;
        onLive(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        onCommit(clamp(width + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 48 : 16)));
      }}
      className="absolute -right-1.5 top-0 z-10 h-full w-3 cursor-col-resize touch-none after:absolute after:left-1/2 after:top-1 after:h-[calc(100%-8px)] after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-accent after:opacity-0 hover:after:opacity-60 focus:after:opacity-80 focus-visible:outline-none"
    />
  );
}

/** Texte d'un calcul de pied de colonne. */
function calcText(api: Api, id: string, prop: Prop | undefined, fn: CalcFn): string {
  const values: Value[] = api.rows.map((r) => (id === "title" ? r.title : r.props[id]));
  const result = computeCalc(fn, values);
  if (!result) return "";
  if (result.kind === "percent") return `${Math.round(Number(result.value) * 10) / 10} %`;
  if (result.kind === "date") return formatDateValue(result.value, api.lang);
  if (result.kind === "number") return formatNumber(Number(result.value), prop?.type === "number" ? prop : undefined, api.lang);
  return String(result.value);
}

function CalcCell({ api, id, prop }: { api: Api; id: string; prop?: Prop }) {
  const t = useT();
  const fn = api.view.calcs?.[id];
  const fns = calcFnsFor(prop?.type ?? "title");
  const set = (next: CalcFn | undefined) => {
    const calcs = { ...api.view.calcs };
    if (next) calcs[id] = next;
    else delete calcs[id];
    api.patchView({ calcs: Object.keys(calcs).length ? calcs : undefined });
  };
  return (
    <Menu
      label={`${t("calculate")} : ${prop?.name ?? t("name")}`}
      className="flex h-full w-full min-w-0 items-center justify-end gap-1.5 px-2 text-xs text-faint hover:bg-hover"
      trigger={
        fn ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate uppercase tracking-wide">{t(CALC_LABELS[fn])}</span>
            <span className="font-medium tabular-nums text-ink">{calcText(api, id, prop, fn)}</span>
          </span>
        ) : (
          <span className="opacity-0 group-hover/foot:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
            {t("calculate")}
          </span>
        )
      }
      items={[
        { label: t("calcNone"), checked: !fn, onClick: () => set(undefined) },
        ...fns.map((f) => ({ label: t(CALC_LABELS[f]), checked: fn === f, onClick: () => set(f) })),
      ]}
    />
  );
}

export function TableView({ api }: { api: Api }) {
  const t = useT();
  const { view, shown } = api;
  const gridRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{ id: string; w: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null | undefined>(undefined);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<{ id: string; after: boolean } | null>(null);
  const [active, setActive] = useState<{ row: string; col: number } | null>(null);

  const width = (id: string) =>
    live?.id === id ? live.w : clamp(view.widths?.[id] ?? (id === "title" ? TITLE_WIDTH : PROP_WIDTH));
  const columns = `${GUTTER}px ${width("title")}px ${shown.map((p) => `${width(p.id)}px`).join(" ")} ${END}px`;
  const commitWidth = (id: string, w: number) => api.patchView({ widths: { ...view.widths, [id]: w } });
  const resetWidth = (id: string) => {
    const widths = { ...view.widths };
    delete widths[id];
    api.patchView({ widths: Object.keys(widths).length ? widths : undefined });
  };

  const cols = [{ id: "title" as const, prop: undefined as Prop | undefined }, ...shown.map((p) => ({ id: p.id, prop: p }))];
  const sorts = viewSorts(view);
  const allSelected = api.rows.length > 0 && api.rows.every((r) => api.selected.has(r.id));

  /** Cellule voisine : même colonne d'une autre ligne, ou autre colonne de la même ligne. */
  const cellAt = (rowId: string, col: number) =>
    gridRef.current?.querySelector<HTMLElement>(`[data-row="${rowId}"] [data-col="${col}"]`) ?? null;
  const rowIds = () => [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].map((r) => r.dataset.row!);
  const focusCell = (rowId: string, col: number) => cellAt(rowId, col)?.focus();

  /** Entre dans la cellule : champ de saisie, bouton (menu) ou case à cocher. */
  const enter = (cell: HTMLElement) => {
    const control = cell.querySelector<HTMLElement>(
      "input:not([type=file]):not([type=hidden]), button, [role=button], textarea",
    );
    if (!control) return;
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "button")) control.click();
    else if (control instanceof HTMLInputElement) {
      control.focus();
      control.select();
    } else control.click();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-cell]");
    if (!cell || !gridRef.current?.contains(cell) || e.altKey || e.ctrlKey || e.metaKey) return;
    const rowId = cell.closest<HTMLElement>("[data-row]")?.dataset.row;
    if (!rowId) return;
    const col = Number(cell.dataset.col);
    const inside = target !== cell;
    // En saisie, les flèches gauche et droite déplacent le curseur de texte ; haut et bas changent de ligne.
    const typing = target instanceof HTMLInputElement && !["checkbox", "file"].includes(target.type);
    const ids = rowIds();
    const at = ids.indexOf(rowId);

    const go = (r: number, c: number) => {
      if (r < 0 || r >= ids.length || c < 0 || c >= cols.length) return false;
      e.preventDefault();
      focusCell(ids[r], c);
      return true;
    };
    switch (e.key) {
      case "ArrowDown":
        go(at + 1, col);
        break;
      case "ArrowUp":
        go(at - 1, col);
        break;
      case "ArrowRight":
        if (!typing) go(at, col + 1);
        break;
      case "ArrowLeft":
        if (!typing) go(at, col - 1);
        break;
      case "Tab": {
        const [r, c] = e.shiftKey
          ? col > 0
            ? [at, col - 1]
            : [at - 1, cols.length - 1]
          : col < cols.length - 1
            ? [at, col + 1]
            : [at + 1, 0];
        go(r, c);
        break;
      }
      case "Enter":
        if (inside && !(target instanceof HTMLButtonElement)) queueMicrotask(() => cell.focus());
        else if (!inside) {
          e.preventDefault();
          enter(cell);
        }
        break;
      case "Escape":
        if (inside) {
          queueMicrotask(() => cell.focus());
          e.stopPropagation();
        }
        break;
      case " ":
        if (!inside && cell.querySelector("input[type=checkbox]")) {
          e.preventDefault();
          enter(cell);
        }
        break;
    }
  };

  const groups = api.groups ?? [{ key: "", rows: api.rows } as const];
  const grouped = api.groups !== null;
  let rowIndex = -1;

  const rowEl = (row: Row) => {
    rowIndex++;
    const index = rowIndex;
    const dropping = overRow?.id === row.id && dragRow !== row.id;
    return (
      <div
        key={row.id}
        data-row={row.id}
        className={`group grid min-h-9 ${LINE} ${api.selected.has(row.id) ? "bg-accent/10" : ""} ${
          dropping ? (overRow.after ? "shadow-[inset_0_-2px_0_var(--color-accent)]" : "shadow-[inset_0_2px_0_var(--color-accent)]") : ""
        }`}
        style={{ gridTemplateColumns: columns }}
        onDragOver={(e) => {
          if (!dragRow) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          setOverRow({ id: row.id, after: e.clientY > box.top + box.height / 2 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragRow && overRow) {
            const at = api.rows.findIndex((r) => r.id === row.id);
            const before = overRow.after ? (api.rows[at + 1]?.id ?? null) : row.id;
            if (before !== dragRow) void api.moveRow(dragRow, before);
          }
          setDragRow(null);
          setOverRow(null);
        }}
      >
        <span className="flex items-center gap-0.5 pl-1">
          {api.canReorder ? (
            <span
              draggable
              role="img"
              aria-label={t("dragRow")}
              title={t("dragRow")}
              onDragStart={(e) => {
                const box = e.currentTarget.closest("[data-row]");
                if (box) e.dataTransfer.setDragImage(box, 8, 8);
                e.dataTransfer.setData("text/plain", row.id);
                setDragRow(row.id);
              }}
              onDragEnd={() => {
                setDragRow(null);
                setOverRow(null);
              }}
              className={`grid size-5 shrink-0 cursor-grab place-items-center rounded text-faint hover:bg-hover max-sm:hidden ${REVEAL}`}
            >
              <GripVertical size={14} />
            </span>
          ) : (
            <span className="size-5 shrink-0 max-sm:hidden" />
          )}
          <input
            type="checkbox"
            aria-label={t("selectRow")}
            checked={api.selected.has(row.id)}
            onChange={() => api.toggleSelected(row.id)}
            className={`size-4 shrink-0 accent-(--color-accent) ${api.selected.has(row.id) ? "opacity-100" : REVEAL}`}
          />
        </span>
        {cols.map(({ id, prop }, c) => (
          <div
            key={id}
            data-cell
            data-col={c}
            role="gridcell"
            tabIndex={active?.row === row.id && active.col === c ? 0 : active === null && index === 0 && c === 0 ? 0 : -1}
            onFocus={() => setActive({ row: row.id, col: c })}
            className="min-w-0 shadow-[inset_-1px_0_0_var(--color-line)] focus-visible:outline-offset-[-2px]"
          >
            {prop ? (
              <PropEditor
                prop={prop}
                value={row.props[id]}
                rowId={row.id}
                onChange={(v) => api.setValue(row, id, v)}
                onOptions={(o) => api.setOptions(id, o)}
              />
            ) : (
              <span className="flex h-full min-h-9 items-center gap-1.5 pl-2 pr-1">
                <PageIcon page={{ icon: row.icon, kind: "note" }} size={16} />
                <TitleInput row={row} api={api} className="h-full" />
                <button
                  onClick={() => api.peek(row.id)}
                  className={`h-6 shrink-0 rounded bg-pop px-1.5 text-xs text-muted shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover ${REVEAL}`}
                >
                  {t("open")}
                </button>
              </span>
            )}
          </div>
        ))}
        <span className={`grid place-items-center ${REVEAL}`}>
          <RowMenu row={row} api={api} index={index} count={api.rows.length} />
        </span>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto" ref={gridRef} onKeyDown={onKeyDown}>
      <div className="min-w-max" role="grid">
        <div
          role="row"
          className={`grid h-8 text-[13px] shadow-[inset_0_1px_0_var(--color-line),inset_0_-1px_0_var(--color-line)]`}
          style={{ gridTemplateColumns: columns }}
        >
          <span className="flex items-center pl-1">
            <input
              type="checkbox"
              aria-label={t("selectAllRows")}
              checked={allSelected}
              onChange={() => api.setSelected(allSelected ? [] : api.rows.map((r) => r.id))}
              className="ml-6 size-4 accent-(--color-accent)"
            />
          </span>
          {cols.map(({ id, prop }) => {
            const sorted = sorts.find((s) => s.prop === id);
            return (
              <div
                key={id}
                role="columnheader"
                className={`relative min-w-0 shadow-[inset_-1px_0_0_var(--color-line)] ${
                  overCol === id && dragCol !== id ? "bg-accent/10" : ""
                }`}
                onDragOver={(e) => {
                  if (!dragCol || !prop) return;
                  e.preventDefault();
                  setOverCol(id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragCol && prop) api.patchView({ order: moveProp(view, api.props, dragCol, id) });
                  setDragCol(null);
                  setOverCol(undefined);
                }}
              >
                <button
                  draggable={!!prop}
                  aria-haspopup="menu"
                  title={prop ? `${prop.name} · ${t(typeLabel(prop.type))}` : t("name")}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", id);
                    setDragCol(id);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setOverCol(undefined);
                  }}
                  onClick={(e) => setMenu({ id, anchor: e.currentTarget.getBoundingClientRect() })}
                  className="flex h-full w-full items-center gap-1 truncate px-2 text-left text-muted hover:bg-hover"
                >
                  <span className="truncate">{prop?.name ?? t("name")}</span>
                  {sorted &&
                    (sorted.dir === "asc" ? (
                      <ArrowUp size={12} className="shrink-0" />
                    ) : (
                      <ArrowDown size={12} className="shrink-0" />
                    ))}
                </button>
                <ResizeHandle
                  label={t("resizeColumn")}
                  width={width(id)}
                  onLive={(w) => setLive(w === null ? null : { id, w })}
                  onCommit={(w) => commitWidth(id, w)}
                  onReset={() => resetWidth(id)}
                />
              </div>
            );
          })}
          <div
            onDragOver={(e) => {
              if (!dragCol) return;
              e.preventDefault();
              setOverCol(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragCol) api.patchView({ order: moveProp(view, api.props, dragCol, null) });
              setDragCol(null);
              setOverCol(undefined);
            }}
            className={overCol === null ? "bg-accent/10" : ""}
          >
            <Menu
              label={t("addProperty")}
              align="right"
              className="grid h-full w-full place-items-center text-muted hover:bg-hover"
              trigger={<Plus size={15} />}
              items={PROP_TYPES.map(([type, key]) => ({
                label: t(key),
                onClick: () =>
                  api.setConfig((c) => ({
                    ...c,
                    props: [
                      ...c.props,
                      { id: uid(), name: t(key), type, ...(type === "relation" ? { target: api.databaseId } : {}) },
                    ],
                  })),
              }))}
            />
          </div>
        </div>
        {groups.map((g) => (
          <Fragment key={g.key || "all"}>
            {grouped && <GroupHeader group={g} api={api} className={`px-1 ${LINE}`} />}
            {!(grouped && isCollapsed(api, g)) && (
              <>
                {g.rows.map((row) => rowEl(row))}
                {grouped && <AddRow onClick={() => api.add(groupPreset(api, g))} />}
              </>
            )}
          </Fragment>
        ))}
        {!grouped && <AddRow onClick={() => api.add()} />}
        <div
          role="row"
          className={`group/foot grid h-8 shadow-[inset_0_1px_0_var(--color-line)]`}
          style={{ gridTemplateColumns: columns }}
        >
          <span />
          {cols.map(({ id, prop }) => (
            <div key={id} className="min-w-0">
              <CalcCell api={api} id={id} prop={prop} />
            </div>
          ))}
          <span />
        </div>
      </div>
      {menu && (
        <ColumnMenu
          id={menu.id}
          anchor={menu.anchor}
          api={api}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
