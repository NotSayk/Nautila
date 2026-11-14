import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, EyeOff, ListFilter, Trash2 } from "lucide-react";
import { viewSorts, withSorts, type PropType } from "../../data/dbquery";
import { convertibleTypes, moveProp, newFilter } from "../../data/dbview";
import { useT } from "../../i18n";
import { Popover } from "../common";
import { PropSettings } from "./PropSettings";
import { PROP_TYPES, typeLabel, uid, type Api } from "./shared";

const ITEM = "flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover";

/** Menu d'un en-tête de colonne : nom, type, réglages, tri, filtre, ordre, masquage, copie et suppression. */
export function ColumnMenu({
  id,
  anchor,
  api,
  onClose,
}: {
  id: string;
  anchor: DOMRect;
  api: Api;
  onClose: () => void;
}) {
  const t = useT();
  const prop = api.props.find((p) => p.id === id);
  if (id !== "title" && !prop) return null;
  const { view, shown } = api;
  const at = shown.findIndex((p) => p.id === id);

  const sortBy = (dir: "asc" | "desc") => {
    api.setConfig((c) => ({ ...c, views: c.views.map((v) => (v.id === view.id ? withSorts(v, [{ prop: id, dir }]) : v)) }));
    onClose();
  };
  const hasValues = prop ? api.rows.some((r) => r.props[prop.id] != null && r.props[prop.id] !== "") : false;
  const targets: PropType[] = prop ? convertibleTypes(prop.type, hasValues) : [];
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const sorted = viewSorts(view).find((s) => s.prop === id);

  return (
    <Popover anchor={anchor} onClose={onClose} width={290}>
      <div className="max-h-[75vh] space-y-1.5 overflow-y-auto p-1">
        {prop && (
          <>
            <input
              autoFocus
              aria-label={t("name")}
              defaultValue={prop.name}
              onBlur={(e) =>
                e.target.value.trim() && e.target.value !== prop.name && api.updateProp(prop.id, { name: e.target.value.trim() })
              }
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="h-8 w-full rounded bg-hover px-2"
            />
            <label className="block space-y-0.5">
              <span className="px-1 text-xs text-faint">{t("propType")}</span>
              <select
                value={prop.type}
                className="h-7 w-full rounded bg-hover px-1.5"
                onChange={(e) => {
                  onClose();
                  void api.convertProp(prop.id, e.target.value as PropType);
                }}
              >
                <option value={prop.type}>{t(typeLabel(prop.type))}</option>
                {PROP_TYPES.filter(([type]) => targets.includes(type)).map(([type, key]) => (
                  <option key={type} value={type}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </label>
            <PropSettings prop={prop} api={api} />
            <div className="my-1 h-px bg-line" />
          </>
        )}
        <button className={ITEM} aria-pressed={sorted?.dir === "asc"} onClick={() => sortBy("asc")}>
          <ArrowUp size={16} className="text-muted" />
          {t("sortAsc")}
        </button>
        <button className={ITEM} aria-pressed={sorted?.dir === "desc"} onClick={() => sortBy("desc")}>
          <ArrowDown size={16} className="text-muted" />
          {t("sortDesc")}
        </button>
        <button
          className={ITEM}
          onClick={run(() => {
            api.patchView({ filters: [...view.filters, newFilter(uid(), id, api.props)] });
            api.openFilters();
          })}
        >
          <ListFilter size={16} className="text-muted" />
          {t("filterByProp")}
        </button>
        {prop && (
          <>
            <div className="my-1 h-px bg-line" />
            {at > 0 && (
              <button
                className={ITEM}
                onClick={run(() => api.patchView({ order: moveProp(view, api.props, id, shown[at - 1].id) }))}
              >
                <ArrowLeft size={16} className="text-muted" />
                {t("moveLeft")}
              </button>
            )}
            {at >= 0 && at < shown.length - 1 && (
              <button
                className={ITEM}
                onClick={run(() => api.patchView({ order: moveProp(view, api.props, id, shown[at + 2]?.id ?? null) }))}
              >
                <ArrowRight size={16} className="text-muted" />
                {t("moveRight")}
              </button>
            )}
            <button className={ITEM} onClick={run(() => api.patchView({ hidden: [...(view.hidden ?? []), id] }))}>
              <EyeOff size={16} className="text-muted" />
              {t("hideInView")}
            </button>
            <button className={ITEM} onClick={run(() => void api.duplicateProp(id))}>
              <Copy size={16} className="text-muted" />
              {t("duplicateProp")}
            </button>
            <button className={`${ITEM} text-danger`} onClick={run(() => api.deleteProp(id))}>
              <Trash2 size={16} />
              {t("deleteProperty")}
            </button>
          </>
        )}
      </div>
    </Popover>
  );
}
