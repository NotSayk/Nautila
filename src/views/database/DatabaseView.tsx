import {
  ArrowUpDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Columns3,
  GanttChart,
  LayoutGrid,
  List,
  ListFilter,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createRow, getDatabase, listRows, newView, saveDatabase, setRowProps } from "../../data/databases";
import {
  applyView,
  evalFormula,
  withFormulas,
  opsFor,
  type DbConfig,
  type DbView,
  type Filter,
  type FilterOp,
  type Option,
  type Prop,
  type PropType,
  type Row,
  type Value,
  type ViewType,
} from "../../data/dbquery";
import { trashPage, updatePageMeta, type PageMeta } from "../../data/pages";
import { useT, type Key } from "../../i18n";
import { useStore } from "../../store";
import { Cover, IconButton, Menu, PageIcon, Popover } from "../common";
import { PropEditor, PropValue } from "./Cells";

const uid = () => crypto.randomUUID().slice(0, 8);

const VIEW_TYPES: [ViewType, Key, typeof Table2][] = [
  ["table", "viewTable", Table2],
  ["board", "viewBoard", Columns3],
  ["calendar", "viewCalendar", CalendarDays],
  ["list", "viewList", List],
  ["gallery", "viewGallery", LayoutGrid],
  ["timeline", "viewTimeline", GanttChart],
];
const PROP_TYPES: [PropType, Key][] = [
  ["text", "propText"],
  ["number", "propNumber"],
  ["select", "propSelect"],
  ["multi_select", "propMulti"],
  ["date", "propDate"],
  ["checkbox", "propCheckbox"],
  ["url", "propUrl"],
  ["formula", "propFormula"],
  ["relation", "propRelation"],
];
const OP_LABELS: Record<FilterOp, Key> = {
  contains: "opContains",
  is: "opIs",
  is_not: "opIsNot",
  empty: "opEmpty",
  not_empty: "opNotEmpty",
  before: "opBefore",
  after: "opAfter",
  checked: "opChecked",
  unchecked: "opUnchecked",
};
const FIELD = "h-7 rounded bg-hover px-1.5";
const LINE = "shadow-[inset_0_-1px_0_var(--color-line)]";

/** Tout ce dont les vues ont besoin pour lire et modifier la base. */
type Api = {
  props: Prop[];
  rows: Row[];
  view: DbView;
  open: (id: string) => void;
  add: (props?: Record<string, Value>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setTitle: (id: string, title: string) => Promise<void>;
  setValue: (row: Row, propId: string, value: Value) => Promise<void>;
  setOptions: (propId: string, options: Option[]) => void;
  setConfig: (update: (config: DbConfig) => DbConfig) => void;
  databaseId: string;
  /** Ligne tout juste créée, dont le nom doit recevoir le curseur. */
  fresh: string | null;
};

function PopButton({
  label,
  icon,
  active,
  width,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  width: number;
  children: React.ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-hover ${active ? "text-accent-text" : "text-muted"}`}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        {icon}
        {label}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width} align="right">
          <div className="p-1">{children}</div>
        </Popover>
      )}
    </>
  );
}

function FilterEditor({ api }: { api: Api }) {
  const t = useT();
  const { view, props } = api;
  const fields = [{ id: "title", name: t("name"), type: "title" as const }, ...props];
  const update = (filters: Filter[]) =>
    api.setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? { ...v, filters } : v)) }));
  const patch = (id: string, p: Partial<Filter>) => update(view.filters.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <div className="space-y-1.5">
      {view.filters.map((f) => {
        const field = fields.find((x) => x.id === f.prop) ?? fields[0];
        const noValue = ["empty", "not_empty", "checked", "unchecked"].includes(f.op);
        const options = "options" in field ? field.options : undefined;
        return (
          <div key={f.id} className="flex items-center gap-1">
            <select
              aria-label={t("name")}
              value={field.id}
              className={`${FIELD} w-28`}
              onChange={(e) => {
                const next = fields.find((x) => x.id === e.target.value)!;
                patch(f.id, { prop: next.id, op: opsFor(next.type)[0], value: "" });
              }}
            >
              {fields.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("filter")}
              value={f.op}
              className={`${FIELD} w-32`}
              onChange={(e) => patch(f.id, { op: e.target.value as FilterOp })}
            >
              {opsFor(field.type).map((op) => (
                <option key={op} value={op}>
                  {t(OP_LABELS[op])}
                </option>
              ))}
            </select>
            {noValue ? (
              <span className="flex-1" />
            ) : options ? (
              <select
                aria-label={t("value")}
                value={f.value}
                className={`${FIELD} min-w-0 flex-1`}
                onChange={(e) => patch(f.id, { value: e.target.value })}
              >
                <option value="" />
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={t("value")}
                type={field.type === "date" ? "date" : "text"}
                value={f.value}
                placeholder={t("value")}
                className={`${FIELD} min-w-0 flex-1 placeholder:text-faint`}
                onChange={(e) => patch(f.id, { value: e.target.value })}
              />
            )}
            <IconButton label={t("delete")} onClick={() => update(view.filters.filter((x) => x.id !== f.id))}>
              <X size={14} />
            </IconButton>
          </div>
        );
      })}
      <button
        className="flex h-7 items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
        onClick={() => update([...view.filters, { id: uid(), prop: "title", op: "contains", value: "" }])}
      >
        <Plus size={14} />
        {t("addFilter")}
      </button>
    </div>
  );
}

function SortEditor({ api }: { api: Api }) {
  const t = useT();
  const { view, props } = api;
  const set = (sort: DbView["sort"]) =>
    api.setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? { ...v, sort } : v)) }));
  return (
    <div className="flex gap-1">
      <select
        aria-label={t("sort")}
        value={view.sort?.prop ?? ""}
        className={`${FIELD} min-w-0 flex-1`}
        onChange={(e) => set(e.target.value ? { prop: e.target.value, dir: view.sort?.dir ?? "asc" } : null)}
      >
        <option value="">{t("noSort")}</option>
        <option value="title">{t("name")}</option>
        {props.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {view.sort && (
        <select
          aria-label={t("ascending")}
          value={view.sort.dir}
          className={FIELD}
          onChange={(e) => set({ prop: view.sort!.prop, dir: e.target.value as "asc" | "desc" })}
        >
          <option value="asc">{t("ascending")}</option>
          <option value="desc">{t("descending")}</option>
        </select>
      )}
    </div>
  );
}

function TitleInput({ row, api, className = "" }: { row: Row; api: Api; className?: string }) {
  const t = useT();
  return (
    <input
      key={row.title}
      autoFocus={api.fresh === row.id}
      aria-label={t("name")}
      defaultValue={row.title}
      placeholder={t("untitled")}
      onBlur={(e) => e.target.value !== row.title && api.setTitle(row.id, e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`min-w-0 flex-1 bg-transparent font-medium placeholder:text-faint ${className}`}
    />
  );
}

function AddRow({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      className="flex h-8 w-full items-center gap-1.5 rounded px-2 text-left text-faint hover:bg-hover"
    >
      <Plus size={14} />
      {t("newRow")}
    </button>
  );
}

function PropHeader({ prop, api }: { prop: Prop; api: Api }) {
  const t = useT();
  const databases = useStore((s) => s.pages).filter((p) => p.kind === "database");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const update = (patch: Partial<Prop>) =>
    api.setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === prop.id ? { ...p, ...patch } : p)) }));
  return (
    <>
      <button
        className="flex h-full w-full items-center truncate px-2 text-left text-muted hover:bg-hover"
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        {prop.name}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={220}>
          <input
            autoFocus
            aria-label={t("name")}
            defaultValue={prop.name}
            onBlur={(e) =>
              e.target.value.trim() && e.target.value !== prop.name && update({ name: e.target.value.trim() })
            }
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="mb-1 h-7 w-full rounded bg-hover px-2"
          />
          <p className="px-2 py-1 text-xs text-faint">{t(PROP_TYPES.find(([type]) => type === prop.type)![1])}</p>
          {prop.type === "formula" && (
            <input
              aria-label={t("propFormula")}
              defaultValue={prop.formula ?? ""}
              placeholder={t("formulaHint")}
              spellCheck={false}
              onBlur={(e) => e.target.value !== (prop.formula ?? "") && update({ formula: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="mb-1 h-7 w-full rounded bg-hover px-2 font-mono text-[13px] placeholder:text-faint"
            />
          )}
          {prop.type === "relation" && (
            <select
              aria-label={t("relatedDb")}
              value={prop.target ?? ""}
              onChange={(e) => update({ target: e.target.value })}
              className="mb-1 h-7 w-full rounded bg-hover px-1.5"
            >
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || t("untitled")}
                </option>
              ))}
            </select>
          )}
          <button
            className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-danger hover:bg-hover"
            onClick={() => {
              setAnchor(null);
              api.setConfig((c) => ({ ...c, props: c.props.filter((p) => p.id !== prop.id) }));
            }}
          >
            <Trash2 size={16} />
            {t("deleteProperty")}
          </button>
        </Popover>
      )}
    </>
  );
}

function TableLayout({ api }: { api: Api }) {
  const t = useT();
  const { props, rows } = api;
  const columns = `280px ${props.map(() => "180px").join(" ")} 40px`;
  const cell = "min-w-0 shadow-[inset_-1px_0_0_var(--color-line)]";
  // Regroupement facultatif par une propriété « sélection » : une section par option.
  const group = props.find((p) => p.id === api.view.groupBy && p.type === "select");
  const groups: { id: string; option?: Option; rows: Row[] }[] = group
    ? [...(group.options ?? []).map((o) => ({ id: o.id, option: o })), { id: "" }]
        .map((g) => ({ ...g, rows: rows.filter((r) => (r.props[group.id] ?? "") === g.id) }))
        .filter((g) => g.rows.length > 0)
    : [{ id: "", rows }];
  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div
          className={`grid h-8 text-[13px] ${LINE} shadow-[inset_0_1px_0_var(--color-line),inset_0_-1px_0_var(--color-line)]`}
          style={{ gridTemplateColumns: columns }}
        >
          <span className={`${cell} flex items-center px-2 text-muted`}>{t("name")}</span>
          {props.map((p) => (
            <span key={p.id} className={cell}>
              <PropHeader prop={p} api={api} />
            </span>
          ))}
          <Menu
            label={t("addProperty")}
            align="right"
            className="grid h-full place-items-center text-muted hover:bg-hover"
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
        {groups.map((g) => (
          <Fragment key={g.id}>
            {group && (
              <div className={`flex h-9 items-center gap-2 px-2 ${LINE}`}>
                {g.option ? (
                  <span className={`tag tag-${g.option.color}`}>{g.option.name}</span>
                ) : (
                  <span className="text-muted">{t("noValue")}</span>
                )}
                <span className="text-faint">{g.rows.length}</span>
              </div>
            )}
            {g.rows.map((row) => (
              <div key={row.id} className={`group grid min-h-9 ${LINE}`} style={{ gridTemplateColumns: columns }}>
                <span className={`${cell} flex items-center gap-1.5 pl-2 pr-1`}>
                  <PageIcon page={{ icon: row.icon, kind: "note" }} size={16} />
                  <TitleInput row={row} api={api} className="h-full" />
                  <button
                    onClick={() => api.open(row.id)}
                    className="hidden h-6 shrink-0 rounded bg-pop px-1.5 text-xs text-muted shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover group-hover:block"
                  >
                    {t("open")}
                  </button>
                </span>
                {props.map((p) => (
                  <span key={p.id} className={cell}>
                    <PropEditor
                      prop={p}
                      value={row.props[p.id]}
                      onChange={(v) => api.setValue(row, p.id, v)}
                      onOptions={(o) => api.setOptions(p.id, o)}
                    />
                  </span>
                ))}
                <IconButton
                  label={t("moveToTrash")}
                  onClick={() => api.remove(row.id)}
                  className="m-auto opacity-0 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </Fragment>
        ))}
        <AddRow onClick={() => api.add()} />
      </div>
    </div>
  );
}

function CardProps({ row, api, skip }: { row: Row; api: Api; skip?: string }) {
  return (
    <>
      {api.props
        .filter((p) => p.id !== skip)
        .map((p) => (
          <PropValue key={p.id} prop={p} value={row.props[p.id]} />
        ))}
    </>
  );
}

function BoardLayout({ api }: { api: Api }) {
  const t = useT();
  const group = api.props.find((p) => p.id === api.view.groupBy && p.type === "select");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!group) return null;
  const columns: { id: string; option?: Option }[] = [
    { id: "" },
    ...(group.options ?? []).map((o) => ({ id: o.id, option: o })),
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map(({ id, option }) => {
        const cards = api.rows.filter((r) => (r.props[group.id] ?? "") === id);
        if (!option && cards.length === 0) return null;
        return (
          <div
            key={id}
            className={`w-64 shrink-0 rounded-lg p-1.5 ${over === id ? "bg-hover" : ""}`}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOver(id);
            }}
            onDragLeave={() => setOver((o) => (o === id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const row = api.rows.find((r) => r.id === dragId);
              if (row) void api.setValue(row, group.id, id || null);
              setDragId(null);
              setOver(null);
            }}
          >
            <div className="mb-2 flex h-7 items-center gap-2 px-1">
              {option ? (
                <span className={`tag tag-${option.color}`}>{option.name}</span>
              ) : (
                <span className="text-muted">{t("noValue")}</span>
              )}
              <span className="text-faint">{cards.length}</span>
            </div>
            <div className="space-y-1.5">
              {cards.map((row) => (
                <button
                  key={row.id}
                  draggable
                  onDragStart={() => setDragId(row.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => api.open(row.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-md bg-pop p-2.5 text-left text-[13px] shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.05)] hover:bg-hover ${
                    dragId === row.id ? "opacity-40" : ""
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {row.icon && <span>{row.icon}</span>}
                    {row.title || <span className="text-faint">{t("untitled")}</span>}
                  </span>
                  <CardProps row={row} api={api} skip={group.id} />
                </button>
              ))}
              <AddRow onClick={() => api.add(id ? { [group.id]: id } : {})} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function CalendarLayout({ api }: { api: Api }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const dateProp = api.props.find((p) => p.id === api.view.dateProp && p.type === "date");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dragId, setDragId] = useState<string | null>(null);
  if (!dateProp) return null;

  // Grille de six semaines commençant un lundi.
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const today = iso(new Date());
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" });
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <span className="flex-1 font-semibold first-letter:uppercase">
          {new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(month)}
        </span>
        <IconButton label={t("previous")} onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <button
          className="h-7 rounded-md px-2 text-muted hover:bg-hover"
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          {t("today")}
        </button>
        <IconButton label={t("next")} onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 text-xs text-faint">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="px-2 pb-1 text-right">
            {weekday.format(d)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 shadow-[inset_1px_1px_0_var(--color-line)]">
        {days.map((d) => {
          const key = iso(d);
          const items = api.rows.filter((r) => r.props[dateProp.id] === key);
          return (
            <div
              key={key}
              className={`group min-h-28 p-1 shadow-[inset_-1px_-1px_0_var(--color-line)] ${d.getMonth() === month.getMonth() ? "" : "bg-panel"}`}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const row = api.rows.find((r) => r.id === dragId);
                if (row) void api.setValue(row, dateProp.id, key);
                setDragId(null);
              }}
            >
              <div className="mb-1 flex h-6 items-center justify-between">
                <button
                  aria-label={`${t("newRow")} ${key}`}
                  onClick={() => api.add({ [dateProp.id]: key })}
                  className="grid size-5 place-items-center rounded text-faint opacity-0 hover:bg-hover focus:opacity-100 group-hover:opacity-100"
                >
                  <Plus size={13} />
                </button>
                <span
                  className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${key === today ? "bg-danger font-medium text-white" : "text-muted"}`}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {items.map((row) => (
                  <button
                    key={row.id}
                    draggable
                    onDragStart={() => setDragId(row.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => api.open(row.id)}
                    className="block w-full truncate rounded bg-pop px-1.5 py-1 text-left text-xs font-medium shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
                  >
                    {row.icon} {row.title || t("untitled")}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListLayout({ api }: { api: Api }) {
  const t = useT();
  return (
    <div>
      {api.rows.map((row) => (
        <div key={row.id} className="group flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-hover">
          <button className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" onClick={() => api.open(row.id)}>
            <PageIcon page={{ icon: row.icon, kind: "note" }} />
            <span className="truncate font-medium">
              {row.title || <span className="text-faint">{t("untitled")}</span>}
            </span>
          </button>
          <span className="flex min-w-0 shrink items-center gap-3 text-[13px] max-sm:hidden">
            <CardProps row={row} api={api} />
          </span>
          <IconButton
            label={t("moveToTrash")}
            onClick={() => api.remove(row.id)}
            className="opacity-0 focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <AddRow onClick={() => api.add()} />
    </div>
  );
}

function GalleryLayout({ api }: { api: Api }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {api.rows.map((row) => (
        <button
          key={row.id}
          onClick={() => api.open(row.id)}
          className="flex flex-col overflow-hidden rounded-lg bg-pop text-left shadow-[0_0_0_1px_var(--color-line),0_2px_4px_rgb(0_0_0/0.04)] hover:bg-hover"
        >
          <span className="grid h-28 w-full place-items-center bg-panel text-4xl">
            {row.cover ? <Cover value={row.cover} /> : row.icon}
          </span>
          <span className="flex flex-col gap-1.5 p-3 text-[13px]">
            <span className="text-sm font-medium">
              {row.title || <span className="text-faint">{t("untitled")}</span>}
            </span>
            <CardProps row={row} api={api} />
          </span>
        </button>
      ))}
      <button
        onClick={() => api.add()}
        className="grid min-h-40 place-items-center rounded-lg text-faint shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

const DAY_MS = 86_400_000;
const DAY_W = 30;
const noon = (isoDate: string) => new Date(`${isoDate}T12:00:00`).getTime();

function TimelineLayout({ api }: { api: Api }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const startProp = api.props.find((p) => p.id === api.view.dateProp && p.type === "date");
  const endProp = api.props.find((p) => p.id === api.view.endProp && p.type === "date");
  if (!startProp) return null;

  const items = api.rows.flatMap((row) => {
    const start = row.props[startProp.id];
    if (typeof start !== "string" || !start) return [];
    const end = endProp && typeof row.props[endProp.id] === "string" ? (row.props[endProp.id] as string) : start;
    return [{ row, start: noon(start), end: Math.max(noon(end || start), noon(start)) }];
  });
  const undated = api.rows.length - items.length;
  // La frise couvre toutes les lignes, avec une marge, et au moins cinq semaines.
  const today = new Date().setHours(12, 0, 0, 0);
  const from = Math.min(today, ...items.map((i) => i.start)) - 3 * DAY_MS;
  const to = Math.max(from + 35 * DAY_MS, ...items.map((i) => i.end + 7 * DAY_MS));
  const days = Array.from({ length: Math.round((to - from) / DAY_MS) + 1 }, (_, i) => new Date(from + i * DAY_MS));
  const month = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" });

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="relative" style={{ width: days.length * DAY_W }}>
          <div className="flex h-6 text-xs text-muted">
            {days.map((d, i) => (
              <span key={i} className="shrink-0 whitespace-nowrap first-letter:uppercase" style={{ width: DAY_W }}>
                {(i === 0 || d.getDate() === 1) && month.format(d)}
              </span>
            ))}
          </div>
          <div className={`flex h-6 text-xs text-faint ${LINE}`}>
            {days.map((d, i) => (
              <span
                key={i}
                className={`shrink-0 text-center ${d.getTime() === today ? "font-semibold text-danger" : ""}`}
                style={{ width: DAY_W }}
              >
                {d.getDate()}
              </span>
            ))}
          </div>
          <div
            className="relative"
            style={{
              height: Math.max(items.length, 1) * 40 + 8,
              backgroundImage: "linear-gradient(90deg, var(--color-line) 1px, transparent 1px)",
              backgroundSize: `${DAY_W * 7}px 100%`,
              backgroundPositionX: -(((new Date(from).getDay() + 6) % 7) * DAY_W),
            }}
          >
            {items.map(({ row, start, end }, i) => (
              <button
                key={row.id}
                onClick={() => api.open(row.id)}
                className="absolute flex h-8 items-center gap-1.5 overflow-hidden rounded-md bg-pop px-2 text-left text-[13px] font-medium shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)] hover:bg-hover"
                style={{
                  top: 8 + i * 40,
                  left: Math.round((start - from) / DAY_MS) * DAY_W + 2,
                  minWidth: (Math.round((end - start) / DAY_MS) + 1) * DAY_W - 4,
                }}
              >
                {row.icon && <span>{row.icon}</span>}
                <span className="whitespace-nowrap">{row.title || t("untitled")}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      {undated > 0 && (
        <p className="mt-2 text-xs text-faint">
          {undated} {t("noDate")}
        </p>
      )}
      <AddRow onClick={() => api.add({ [startProp.id]: iso(new Date()) })} />
    </div>
  );
}

export function DatabaseView({ page, embedded }: { page: PageMeta; embedded?: boolean }) {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  const [config, setConfigState] = useState<DbConfig | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const reload = useCallback(async () => setRows(await listRows(page.id)), [page.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      let loaded = await getDatabase(page.id);
      if (!loaded) {
        loaded = { props: [], views: [newView("table", t("viewTable"))] };
        await saveDatabase(page.id, loaded);
      }
      const list = await listRows(page.id);
      if (!live) return;
      setConfigState(loaded);
      setRows(list);
    })();
    return () => {
      live = false;
    };
    // `t` change avec la langue mais ne sert qu'au nom de la vue initiale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const setConfig = useCallback(
    (update: (c: DbConfig) => DbConfig) =>
      setConfigState((current) => {
        if (!current) return current;
        const next = update(current);
        void saveDatabase(page.id, next);
        return next;
      }),
    [page.id],
  );

  const view = config?.views.find((v) => v.id === viewId) ?? config?.views[0];
  const visible = useMemo(
    () => (config && view ? applyView(withFormulas(rows, config.props), view, config.props) : []),
    [rows, view, config],
  );
  if (!config || !view) return null;

  const refreshPages = () => useStore.getState().refreshPages();
  const api: Api = {
    databaseId: page.id,
    props: config.props,
    rows: visible,
    view,
    fresh,
    setConfig,
    open: (id) => navigate({ view: "page", id }),
    add: async (props = {}) => {
      // Une ligne créée sous un filtre « est » reçoit la valeur filtrée, pour rester visible.
      const preset: Record<string, Value> = {};
      for (const f of view.filters) if (f.op === "is" && f.prop !== "title" && f.value) preset[f.prop] = f.value;
      const id = await createRow(page.id, { ...preset, ...props });
      setFresh(id);
      await reload();
      await refreshPages();
    },
    remove: async (id) => {
      await trashPage(id);
      await reload();
      await refreshPages();
    },
    setTitle: async (id, title) => {
      await updatePageMeta(id, { title });
      await reload();
      await refreshPages();
    },
    setValue: async (row, propId, value) => {
      const props = { ...row.props, [propId]: value };
      setRows((list) => list.map((r) => (r.id === row.id ? { ...r, props } : r)));
      await setRowProps(row.id, props);
    },
    setOptions: (propId, options) =>
      setConfig((c) => ({ ...c, props: c.props.map((p) => (p.id === propId ? { ...p, options } : p)) })),
  };

  const addView = (type: ViewType, name: string) =>
    setConfig((c) => {
      const next = newView(type, name);
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
      setViewId(next.id);
      return { props, views: [...c.views, next] };
    });

  const patchView = (patch: Partial<DbView>) =>
    setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) }));
  const pickers: [keyof DbView, PropType, boolean][] = [
    ["groupBy", "select", view.type === "board" || view.type === "table"],
    ["dateProp", "date", view.type === "calendar" || view.type === "timeline"],
    ["endProp", "date", view.type === "timeline"],
  ];

  return (
    <div className={embedded ? "" : "px-(--page-pad) pb-32 pt-4"}>
      <div className={`mb-3 flex flex-wrap items-center gap-x-1 gap-y-2 ${LINE}`}>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {config.views.map((v) => {
            const Icon = VIEW_TYPES.find(([type]) => type === v.type)![2];
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
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="mb-1 h-7 w-32 rounded bg-hover px-2"
              />
            ) : (
              <button
                key={v.id}
                onClick={() => setViewId(v.id)}
                onDoubleClick={() => setRenaming(v.id)}
                className={`mb-[-1px] flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2 font-medium ${
                  active ? "border-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <Icon size={15} strokeWidth={1.75} />
                {v.name}
              </button>
            );
          })}
          <Menu
            label={t("addView")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover"
            trigger={<Plus size={15} />}
            items={[
              ...VIEW_TYPES.map(([type, key, Icon]) => ({
                icon: <Icon size={16} />,
                label: t(key),
                onClick: () => addView(type, t(key)),
              })),
              ...(config.views.length > 1
                ? [
                    "separator" as const,
                    {
                      icon: <Trash2 size={16} />,
                      label: `${t("deleteView")} « ${view.name} »`,
                      danger: true,
                      onClick: () => {
                        setViewId(null);
                        setConfig((c) => ({ ...c, views: c.views.filter((v) => v.id !== view.id) }));
                      },
                    },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="flex items-center gap-0.5 pb-1">
          {pickers.map(
            ([key, type, shown]) =>
              shown && (
                <select
                  key={key}
                  aria-label={t(key === "groupBy" ? "groupBy" : key === "endProp" ? "endDate" : "propDate")}
                  value={(view[key] as string) ?? ""}
                  onChange={(e) => patchView({ [key]: e.target.value })}
                  className="h-7 max-w-36 rounded-md bg-transparent px-1 text-muted hover:bg-hover"
                >
                  {key === "groupBy" && view.type === "table" && (
                    <option value="">
                      {t("groupBy")} : {t("none").toLowerCase()}
                    </option>
                  )}
                  {key === "endProp" && (
                    <option value="">
                      {t("endDate")} : {t("none").toLowerCase()}
                    </option>
                  )}
                  {config.props
                    .filter((p) => p.type === type)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              ),
          )}
          <PopButton
            label={view.filters.length ? `${t("filter")} · ${view.filters.length}` : t("filter")}
            icon={<ListFilter size={15} />}
            active={view.filters.length > 0}
            width={420}
          >
            <FilterEditor api={api} />
          </PopButton>
          <PopButton label={t("sort")} icon={<ArrowUpDown size={15} />} active={!!view.sort} width={300}>
            <SortEditor api={api} />
          </PopButton>
          <button
            onClick={() => api.add()}
            className="ml-1 h-7 rounded-md bg-accent px-2.5 font-medium text-white hover:brightness-95"
          >
            {t("newRow")}
          </button>
        </div>
      </div>

      {view.type === "table" && <TableLayout api={api} />}
      {view.type === "board" && <BoardLayout api={api} />}
      {view.type === "calendar" && <CalendarLayout api={api} />}
      {view.type === "list" && <ListLayout api={api} />}
      {view.type === "gallery" && <GalleryLayout api={api} />}
      {view.type === "timeline" && <TimelineLayout api={api} />}
      {visible.length === 0 && rows.length > 0 && <p className="py-6 text-center text-muted">{t("emptyDb")}</p>}
    </div>
  );
}

/** Propriétés d'une ligne, affichées en tête de sa page. */
export function RowProperties({ page, databaseId }: { page: PageMeta; databaseId: string }) {
  const [config, setConfig] = useState<DbConfig | null>(null);
  const [values, setValues] = useState<Record<string, Value>>({});

  useEffect(() => {
    let live = true;
    Promise.all([getDatabase(databaseId), listRows(databaseId)]).then(([c, rows]) => {
      if (!live) return;
      setConfig(c);
      setValues(rows.find((r) => r.id === page.id)?.props ?? {});
    });
    return () => {
      live = false;
    };
  }, [databaseId, page.id]);

  if (!config || config.props.length === 0) return null;
  return (
    <div className={`mt-3 pb-3 ${LINE}`}>
      {config.props.map((p) => (
        <div key={p.id} className="flex min-h-8 items-stretch text-[14px]">
          <span className="flex w-40 shrink-0 items-center truncate text-muted">{p.name}</span>
          <span className="min-w-0 flex-1 rounded hover:bg-hover">
            <PropEditor
              prop={p}
              value={p.type === "formula" ? evalFormula(p.formula ?? "", values, config.props) : values[p.id]}
              onChange={(v) => {
                const next = { ...values, [p.id]: v };
                setValues(next);
                void setRowProps(page.id, next);
              }}
              onOptions={(options) => {
                const next = { ...config, props: config.props.map((x) => (x.id === p.id ? { ...x, options } : x)) };
                setConfig(next);
                void saveDatabase(databaseId, next);
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
