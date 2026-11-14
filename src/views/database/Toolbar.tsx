import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GROUPABLE } from "../../data/dbgroup";
import { RELATIVE_PRESETS, type DateBucket } from "../../data/dbdate";
import {
  opsFor,
  orderedProps,
  valueless,
  viewSorts,
  withSorts,
  type Filter,
  type FilterOp,
  type Prop,
  type PropType,
  type Sort,
} from "../../data/dbquery";
import { addFilter, countFilters, dropFilter, mapFilter, newFilter, nudgeProp } from "../../data/dbview";
import { useT, type Key } from "../../i18n";
import { useStore } from "../../store";
import { IconButton, Popover } from "../common";
import { FIELD, typeLabel, uid, type Api } from "./shared";

const OP_LABELS: Record<FilterOp, Key> = {
  contains: "opContains",
  not_contains: "opNotContains",
  starts_with: "opStartsWith",
  ends_with: "opEndsWith",
  eq: "opEq",
  neq: "opNeq",
  lt: "opLt",
  lte: "opLte",
  gt: "opGt",
  gte: "opGte",
  on_or_before: "opOnOrBefore",
  on_or_after: "opOnOrAfter",
  between: "opBetween",
  relative: "opRelative",
  is: "opIs",
  is_not: "opIsNot",
  empty: "opEmpty",
  not_empty: "opNotEmpty",
  before: "opBefore",
  after: "opAfter",
  checked: "opChecked",
  unchecked: "opUnchecked",
};
const RELATIVE_LABELS: Record<(typeof RELATIVE_PRESETS)[number], Key> = {
  today: "relToday",
  yesterday: "relYesterday",
  tomorrow: "relTomorrow",
  this_week: "relThisWeek",
  last_week: "relLastWeek",
  next_week: "relNextWeek",
  this_month: "relThisMonth",
  last_month: "relLastMonth",
  next_month: "relNextMonth",
  past_7: "relPast7",
  next_7: "relNext7",
  past_30: "relPast30",
  next_30: "relNext30",
};
const DATE_TYPES: (PropType | "title")[] = ["date", "created_time", "last_edited_time"];

/** Bouton de la barre d'outils qui ouvre un panneau ; `signal` l'ouvre depuis l'extérieur. */
export function PopButton({
  label,
  icon,
  active,
  width,
  signal = 0,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  width: number;
  signal?: number;
  children: React.ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (signal > 0 && ref.current) setAnchor(ref.current.getBoundingClientRect());
  }, [signal]);
  return (
    <>
      <button
        ref={ref}
        aria-haspopup="dialog"
        title={label}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 hover:bg-hover ${active ? "text-accent-text" : "text-muted"}`}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        {icon}
        <span className="max-md:sr-only">{label}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width} align="right">
          <div className="max-h-[70vh] overflow-y-auto p-1">{children}</div>
        </Popover>
      )}
    </>
  );
}

function ModeSelect({ mode, onChange }: { mode: "and" | "or" | undefined; onChange: (m: "and" | "or") => void }) {
  const t = useT();
  return (
    <select
      aria-label={t("filterMode")}
      value={mode ?? "and"}
      onChange={(e) => onChange(e.target.value as "and" | "or")}
      className={`${FIELD} w-16`}
    >
      <option value="and">{t("filterAnd")}</option>
      <option value="or">{t("filterOr")}</option>
    </select>
  );
}

/** Champ de saisie de la valeur d'un filtre, selon le type de la propriété et l'opérateur. */
function ValueInput({ filter, prop, onChange }: { filter: Filter; prop?: Prop; onChange: (p: Partial<Filter>) => void }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const type = prop?.type ?? "title";
  if (valueless(filter.op)) return <span className="flex-1" />;
  const common = `${FIELD} min-w-0 flex-1 placeholder:text-faint`;

  if (DATE_TYPES.includes(type)) {
    if (filter.op === "relative")
      return (
        <select aria-label={t("value")} value={filter.value} className={common} onChange={(e) => onChange({ value: e.target.value })}>
          <option value="" />
          {RELATIVE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(RELATIVE_LABELS[p])}
            </option>
          ))}
        </select>
      );
    return (
      <span className="flex min-w-0 flex-1 gap-1">
        <input
          type="date"
          aria-label={t("value")}
          value={filter.value}
          className={common}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        {filter.op === "between" && (
          <input
            type="date"
            aria-label={t("value")}
            value={filter.value2 ?? ""}
            className={common}
            onChange={(e) => onChange({ value2: e.target.value })}
          />
        )}
      </span>
    );
  }
  if (type === "select" || type === "multi_select")
    return (
      <select aria-label={t("value")} value={filter.value} className={common} onChange={(e) => onChange({ value: e.target.value })}>
        <option value="" />
        {(prop?.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  if (type === "relation")
    return (
      <select aria-label={t("value")} value={filter.value} className={common} onChange={(e) => onChange({ value: e.target.value })}>
        <option value="" />
        {pages
          .filter((p) => p.parent_id === prop?.target)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || t("untitled")}
            </option>
          ))}
      </select>
    );
  return (
    <input
      aria-label={t("value")}
      inputMode={type === "number" ? "decimal" : undefined}
      value={filter.value}
      placeholder={t("value")}
      className={common}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  );
}

/** Liste de conditions d'un niveau (la vue, ou un groupe), combinées en ET ou en OU. */
function FilterLevel({
  api,
  filters,
  mode,
  onMode,
  groupId,
}: {
  api: Api;
  filters: Filter[];
  mode: "and" | "or" | undefined;
  onMode: (m: "and" | "or") => void;
  groupId: string | null;
}) {
  const t = useT();
  const fields: { id: string; name: string; type: PropType | "title" }[] = [
    { id: "title", name: t("name"), type: "title" },
    ...api.props,
  ];
  const update = (next: Filter[]) => api.patchView({ filters: next });
  const patch = (id: string, p: Partial<Filter>) => update(mapFilter(api.view.filters, id, (f) => ({ ...f, ...p })));

  return (
    <div className="space-y-1.5">
      {filters.map((f, i) => {
        const lead =
          i === 0 ? (
            <span className="w-16 shrink-0 px-1 text-muted">{t("filterWhere")}</span>
          ) : i === 1 ? (
            <ModeSelect mode={mode} onChange={onMode} />
          ) : (
            <span className="w-16 shrink-0 px-1 text-muted">{mode === "or" ? t("filterOr") : t("filterAnd")}</span>
          );
        if (f.group)
          return (
            <div key={f.id} className="flex items-start gap-1">
              {lead}
              <div className="min-w-0 flex-1 space-y-1.5 rounded-md bg-panel p-1.5" role="group" aria-label={t("filterGroup")}>
                <FilterLevel
                  api={api}
                  filters={f.group}
                  mode={f.mode}
                  onMode={(m) => patch(f.id, { mode: m })}
                  groupId={f.id}
                />
              </div>
              <IconButton label={t("delete")} onClick={() => update(dropFilter(api.view.filters, f.id))}>
                <X size={14} />
              </IconButton>
            </div>
          );
        const field = fields.find((x) => x.id === f.prop) ?? fields[0];
        const prop = api.props.find((p) => p.id === field.id);
        return (
          <div key={f.id} className="flex items-center gap-1">
            {lead}
            <select
              aria-label={t("name")}
              value={field.id}
              className={`${FIELD} w-24`}
              onChange={(e) => {
                const next = fields.find((x) => x.id === e.target.value)!;
                patch(f.id, { prop: next.id, op: opsFor(next.type)[0], value: "", value2: undefined });
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
              className={`${FIELD} w-24`}
              onChange={(e) => {
                const op = e.target.value as FilterOp;
                // Une période relative et une date précise ne se convertissent pas l'une en l'autre.
                const reset = (op === "relative") !== (f.op === "relative");
                patch(f.id, { op, ...(reset ? { value: "", value2: undefined } : {}) });
              }}
            >
              {opsFor(field.type).map((op) => (
                <option key={op} value={op}>
                  {t(OP_LABELS[op])}
                </option>
              ))}
            </select>
            <ValueInput filter={f} prop={prop} onChange={(p) => patch(f.id, p)} />
            <IconButton label={t("delete")} onClick={() => update(dropFilter(api.view.filters, f.id))}>
              <X size={14} />
            </IconButton>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1">
        <button
          className="flex h-7 items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
          onClick={() => update(addFilter(api.view.filters, newFilter(uid(), "title", api.props), groupId))}
        >
          <Plus size={14} />
          {t("addFilter")}
        </button>
        {groupId === null && (
          <button
            className="flex h-7 items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
            onClick={() =>
              update(
                addFilter(api.view.filters, {
                  id: uid(),
                  prop: "",
                  op: "is",
                  value: "",
                  mode: "or",
                  group: [newFilter(uid(), "title", api.props)],
                }),
              )
            }
          >
            <Plus size={14} />
            {t("addFilterGroup")}
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterEditor({ api }: { api: Api }) {
  const t = useT();
  const { view } = api;
  return (
    <div className="space-y-2">
      {view.filters.length === 0 && <p className="px-1 py-0.5 text-muted">{t("noFilters")}</p>}
      <FilterLevel
        api={api}
        filters={view.filters}
        mode={view.filterMode}
        onMode={(filterMode) => api.patchView({ filterMode })}
        groupId={null}
      />
    </div>
  );
}

export const filterCount = (api: Pick<Api, "view">) => countFilters(api.view.filters);

export function SortEditor({ api }: { api: Api }) {
  const t = useT();
  const { view, props } = api;
  const fields = [{ id: "title", name: t("name") }, ...props];
  // Un tri sur une propriété supprimée est traité comme absent.
  const sorts = viewSorts(view).filter((s) => fields.some((f) => f.id === s.prop));
  const set = (next: Sort[]) => api.setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? withSorts(v, next) : v)) }));
  const swap = (i: number, delta: -1 | 1) => {
    const next = [...sorts];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    set(next);
  };
  const unused = fields.find((f) => !sorts.some((s) => s.prop === f.id));

  return (
    <div className="space-y-1.5">
      {sorts.length === 0 && <p className="px-1 py-0.5 text-muted">{t("noSorts")}</p>}
      {sorts.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          <select
            aria-label={t("sort")}
            value={s.prop}
            className={`${FIELD} min-w-0 flex-1`}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)))}
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("ascending")}
            value={s.dir}
            className={FIELD}
            onChange={(e) => set(sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as Sort["dir"] } : x)))}
          >
            <option value="asc">{t("ascending")}</option>
            <option value="desc">{t("descending")}</option>
          </select>
          <IconButton label={t("moveUp")} disabled={i === 0} onClick={() => swap(i, -1)} className="disabled:opacity-30">
            <ArrowUp size={14} />
          </IconButton>
          <IconButton
            label={t("moveDown")}
            disabled={i === sorts.length - 1}
            onClick={() => swap(i, 1)}
            className="disabled:opacity-30"
          >
            <ArrowDown size={14} />
          </IconButton>
          <IconButton label={t("delete")} onClick={() => set(sorts.filter((_, j) => j !== i))}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      {unused && (
        <button
          className="flex h-7 items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
          onClick={() => set([...sorts, { prop: unused.id, dir: "asc" }])}
        >
          <Plus size={14} />
          {t("addSort")}
        </button>
      )}
    </div>
  );
}

const BUCKETS: [DateBucket, Key][] = [
  ["day", "groupDay"],
  ["week", "groupWeek"],
  ["month", "groupMonth"],
  ["year", "groupYear"],
];

export function GroupEditor({ api }: { api: Api }) {
  const t = useT();
  const { view } = api;
  const eligible = api.props.filter((p) => GROUPABLE.includes(p.type));
  const current = api.groupProp;
  return (
    <div className="space-y-1.5">
      <select
        aria-label={t("groupBy")}
        value={current?.id ?? ""}
        className={`${FIELD} w-full`}
        onChange={(e) => api.patchView({ groupBy: e.target.value || undefined, collapsed: undefined })}
      >
        {view.type !== "board" && <option value="">{t("groupNone")}</option>}
        {view.type === "board" && !current && <option value="">{t("chooseProp")}</option>}
        {eligible.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {t(typeLabel(p.type))}
          </option>
        ))}
      </select>
      {current?.type === "date" && (
        <select
          aria-label={t("group")}
          value={view.groupDate ?? "month"}
          className={`${FIELD} w-full`}
          onChange={(e) => api.patchView({ groupDate: e.target.value as DateBucket, collapsed: undefined })}
        >
          {BUCKETS.map(([bucket, key]) => (
            <option key={bucket} value={bucket}>
              {t(key)}
            </option>
          ))}
        </select>
      )}
      {current && view.type === "board" && (
        <label className="flex h-7 items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={!!view.hideEmptyGroups}
            onChange={(e) => api.patchView({ hideEmptyGroups: e.target.checked || undefined })}
            className="size-4 accent-(--color-accent)"
          />
          {t("hideEmptyGroups")}
        </label>
      )}
    </div>
  );
}

/** Propriétés affichées dans la vue : visibilité et ordre. */
export function PropertiesEditor({ api }: { api: Api }) {
  const t = useT();
  const { view, props } = api;
  const ordered = orderedProps(props, view);
  const hidden = view.hidden ?? [];
  const toggle = (id: string) =>
    api.patchView({ hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  return (
    <div className="space-y-0.5">
      <div className="flex gap-1 pb-1">
        <button
          className="h-7 flex-1 rounded px-2 text-muted hover:bg-hover"
          onClick={() => api.patchView({ hidden: undefined })}
        >
          {t("showAllProps")}
        </button>
        <button
          className="h-7 flex-1 rounded px-2 text-muted hover:bg-hover"
          onClick={() => api.patchView({ hidden: props.map((p) => p.id) })}
        >
          {t("hideAllProps")}
        </button>
      </div>
      {ordered.length === 0 && <p className="px-1 py-0.5 text-muted">{t("noEligibleProp")}</p>}
      {ordered.map((p, i) => {
        const off = hidden.includes(p.id);
        return (
          <div key={p.id} className="flex items-center gap-1 rounded px-1 hover:bg-hover">
            <IconButton label={`${off ? t("showProp") : t("hideProp")} : ${p.name}`} onClick={() => toggle(p.id)}>
              {off ? <EyeOff size={15} /> : <Eye size={15} />}
            </IconButton>
            <span className={`min-w-0 flex-1 truncate ${off ? "text-faint" : ""}`}>{p.name}</span>
            <IconButton
              label={t("moveUp")}
              disabled={i === 0}
              onClick={() => api.patchView({ order: nudgeProp(view, props, p.id, -1) })}
              className="size-6 disabled:opacity-30"
            >
              <ArrowUp size={13} />
            </IconButton>
            <IconButton
              label={t("moveDown")}
              disabled={i === ordered.length - 1}
              onClick={() => api.patchView({ order: nudgeProp(view, props, p.id, 1) })}
              className="size-6 disabled:opacity-30"
            >
              <ArrowDown size={13} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
