import { ChevronDown, ChevronRight, Copy, ExternalLink, MoreHorizontal, PanelRight, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useEffect, useRef } from "react";
import { bucketLabel } from "../../data/dbdate";
import type { Group } from "../../data/dbgroup";
import { valueForGroup } from "../../data/dbgroup";
import type { PropType, Row, Value } from "../../data/dbquery";
import { toggleCollapsed } from "../../data/dbview";
import { useT } from "../../i18n";
import { Menu } from "../common";
import { PropValue } from "./Cells";
import { FIELD, type Api } from "./shared";

/** Vue dont la propriété de regroupement ou de date a disparu : on propose d'en choisir une autre. */
export function MissingProp({
  api,
  types,
  field,
}: {
  api: Api;
  types: PropType[];
  field: "groupBy" | "dateProp";
}) {
  const t = useT();
  const eligible = api.props.filter((p) => types.includes(p.type));
  return (
    <div className="flex flex-col items-start gap-2 py-6 text-muted">
      <p>{t(field === "groupBy" ? "needGroupProp" : "needDateProp")}</p>
      {eligible.length === 0 ? (
        <p className="text-faint">{t("noEligibleProp")}</p>
      ) : (
        <select
          aria-label={t(field === "groupBy" ? "groupBy" : "propDate")}
          value=""
          className={FIELD}
          onChange={(e) => e.target.value && api.patchView({ [field]: e.target.value })}
        >
          <option value="">{t("chooseProp")}</option>
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function AddRow({ onClick }: { onClick: () => void }) {
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

/** Nom d'une ligne, modifiable ; le curseur y va une seule fois quand la ligne vient d'être créée. */
export function TitleInput({ row, api, className = "" }: { row: Row; api: Api; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const { fresh, clearFresh } = api;
  useEffect(() => {
    if (fresh !== row.id) return;
    ref.current?.focus();
    clearFresh();
  }, [fresh, row.id, clearFresh]);
  return (
    <input
      ref={ref}
      key={row.title}
      aria-label={t("name")}
      defaultValue={row.title}
      placeholder={t("untitled")}
      onBlur={(e) => e.target.value !== row.title && api.setTitle(row.id, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.value = row.title;
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      className={`min-w-0 flex-1 bg-transparent font-medium placeholder:text-faint ${className}`}
    />
  );
}

/** Menu d'actions d'une ligne : aperçu, page, copie, ordre et suppression. */
export function RowMenu({ row, api, index, count }: { row: Row; api: Api; index?: number; count?: number }) {
  const t = useT();
  const ordered = api.canReorder && index !== undefined && count !== undefined;
  return (
    <Menu
      label={t("rowMenu")}
      align="right"
      className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover"
      trigger={<MoreHorizontal size={15} />}
      items={[
        { icon: <PanelRight size={16} />, label: t("open"), onClick: () => api.peek(row.id) },
        { icon: <ExternalLink size={16} />, label: t("openFullPage"), onClick: () => api.openPage(row.id) },
        { icon: <Copy size={16} />, label: t("duplicate"), onClick: () => void api.duplicate(row.id) },
        ...(ordered
          ? [
              {
                icon: <ArrowUp size={16} />,
                label: t("moveUp"),
                onClick: () => void api.moveRow(row.id, api.rows[index! - 1]?.id ?? null),
              },
              {
                icon: <ArrowDown size={16} />,
                label: t("moveDown"),
                onClick: () => void api.moveRow(row.id, api.rows[index! + 2]?.id ?? null),
              },
            ].filter((_, i) => (i === 0 ? index! > 0 : index! < count! - 1))
          : []),
        "separator" as const,
        { icon: <Trash2 size={16} />, label: t("moveToTrash"), danger: true, onClick: () => void api.remove(row.id) },
      ]}
    />
  );
}

/** Étiquette d'un groupe : option colorée, case, période, ligne liée ou « sans valeur ». */
export function GroupLabel({ group, api }: { group: Group; api: Api }) {
  const t = useT();
  const prop = api.groupProp;
  if (!prop || group.key === "") return <span className="text-muted">{t("noValue")}</span>;
  if (group.option) return <span className={`tag tag-${group.option.color}`}>{group.option.name}</span>;
  if (prop.type === "checkbox")
    return <span className="font-medium">{group.key === "true" ? t("groupChecked") : t("groupUnchecked")}</span>;
  if (prop.type === "date")
    return <span className="font-medium">{bucketLabel(group.key, api.view.groupDate ?? "month", api.lang)}</span>;
  if (prop.type === "relation") return <span className="font-medium">{api.titleOf(group.key) || t("untitled")}</span>;
  return <span className="font-medium">{group.key}</span>;
}

/** En-tête d'un groupe repliable ; l'état replié est enregistré dans la vue. */
export function GroupHeader({ group, api, className = "" }: { group: Group; api: Api; className?: string }) {
  const t = useT();
  const collapsed = (api.view.collapsed ?? []).includes(group.key);
  return (
    <div className={`flex h-9 items-center gap-1 ${className}`}>
      <button
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? t("expandGroup") : t("collapseGroup")}`}
        title={collapsed ? t("expandGroup") : t("collapseGroup")}
        onClick={() => api.patchView({ collapsed: toggleCollapsed(api.view.collapsed, group.key) })}
        className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-hover"
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      </button>
      <GroupLabel group={group} api={api} />
      <span className="text-faint">{group.rows.length}</span>
    </div>
  );
}

export const isCollapsed = (api: Api, group: Group) => (api.view.collapsed ?? []).includes(group.key);

/** Valeurs à donner à une ligne créée dans un groupe, pour qu'elle y reste. */
export function groupPreset(api: Api, group: Group): Record<string, Value> {
  const prop = api.groupProp;
  if (!prop) return {};
  const value = valueForGroup(prop, null, "", group.key);
  return value === undefined || value === null ? {} : { [prop.id]: value };
}

/** Valeurs des propriétés affichées, pour une carte ou une ligne de liste. */
export function CardProps({ row, api, skip }: { row: Row; api: Api; skip?: string }) {
  return (
    <>
      {api.shown
        .filter((p) => p.id !== skip)
        .map((p) => (
          <PropValue key={p.id} prop={p} value={row.props[p.id]} />
        ))}
    </>
  );
}
