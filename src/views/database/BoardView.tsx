import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { GROUPABLE, valueForGroup } from "../../data/dbgroup";
import { toggleCollapsed } from "../../data/dbview";
import { useT } from "../../i18n";
import { AddRow, CardProps, GroupLabel, groupPreset, isCollapsed, MissingProp } from "./Parts";
import type { Api } from "./shared";

/** Kanban : une colonne par groupe ; les cartes se déplacent d'une colonne à l'autre quand la propriété s'y prête. */
export function BoardView({ api }: { api: Api }) {
  const t = useT();
  const prop = api.groupProp;
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!prop || !api.groups) return <MissingProp api={api} types={GROUPABLE} field="groupBy" />;
  // Seules les sélections et les cases à cocher donnent une valeur à une colonne : les autres groupes sont en lecture.
  const movable = valueForGroup(prop, null, "", "x") !== undefined;

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {api.groups.map((group) => {
        const collapsed = isCollapsed(api, group);
        return (
          <div
            key={group.key}
            className={`w-64 shrink-0 rounded-lg p-1.5 ${over === group.key ? "bg-hover" : ""}`}
            onDragOver={(e) => {
              if (!drag || !movable) return;
              e.preventDefault();
              setOver(group.key);
            }}
            onDragLeave={() => setOver((o) => (o === group.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              const row = api.rows.find((r) => r.id === drag?.id);
              if (row && drag && drag.from !== group.key) {
                const value = valueForGroup(prop, row.props[prop.id], drag.from, group.key);
                if (value !== undefined) void api.setValue(row, prop.id, value);
              }
              setDrag(null);
              setOver(null);
            }}
          >
            <div className="mb-2 flex h-7 items-center gap-1 px-1">
              <button
                aria-expanded={!collapsed}
                aria-label={collapsed ? t("expandGroup") : t("collapseGroup")}
                title={collapsed ? t("expandGroup") : t("collapseGroup")}
                onClick={() => api.patchView({ collapsed: toggleCollapsed(api.view.collapsed, group.key) })}
                className="grid size-6 place-items-center rounded text-muted hover:bg-hover"
              >
                <ChevronRight size={15} className={collapsed ? "" : "rotate-90"} />
              </button>
              <GroupLabel group={group} api={api} />
              <span className="text-faint">{group.rows.length}</span>
            </div>
            {!collapsed && (
              <div className="space-y-1.5">
                {group.rows.map((row) => (
                  <button
                    key={row.id}
                    draggable={movable}
                    onDragStart={() => setDrag({ id: row.id, from: group.key })}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onClick={() => api.peek(row.id)}
                    className={`flex w-full flex-col gap-1.5 rounded-md bg-pop p-2.5 text-left text-[13px] shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.05)] hover:bg-hover ${
                      drag?.id === row.id ? "opacity-40" : ""
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {row.icon && <span>{row.icon}</span>}
                      {row.title || <span className="text-faint">{t("untitled")}</span>}
                    </span>
                    <CardProps row={row} api={api} skip={prop.id} />
                  </button>
                ))}
                <AddRow onClick={() => api.add(groupPreset(api, group))} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
