import { Plus } from "lucide-react";
import { Fragment } from "react";
import { useT } from "../../i18n";
import { Cover } from "../common";
import { CardProps, GroupHeader, groupPreset, isCollapsed } from "./Parts";
import type { Api } from "./shared";

export function GalleryView({ api }: { api: Api }) {
  const t = useT();
  const groups = api.groups ?? [{ key: "", rows: api.rows }];
  const grouped = api.groups !== null;
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Fragment key={group.key || "all"}>
          {grouped && <GroupHeader group={group} api={api} />}
          {!(grouped && isCollapsed(api, group)) && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 max-sm:grid-cols-1">
              {group.rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => api.peek(row.id)}
                  className="flex flex-col overflow-hidden rounded-lg bg-pop text-left shadow-[0_0_0_1px_var(--color-line),0_2px_4px_rgb(0_0_0/0.04)] hover:bg-hover"
                >
                  <span className="grid h-28 w-full place-items-center bg-panel text-4xl">
                    {row.cover ? <Cover value={row.cover} /> : row.icon}
                  </span>
                  <span className="flex flex-col gap-1.5 p-3 text-[13px]">
                    <span className="text-sm font-medium">
                      {row.title || <span className="text-faint">{t("untitled")}</span>}
                    </span>
                    <CardProps row={row} api={api} skip={api.groupProp?.id} />
                  </span>
                </button>
              ))}
              <button
                aria-label={t("newRow")}
                title={t("newRow")}
                onClick={() => api.add(groupPreset(api, group))}
                className="grid min-h-40 place-items-center rounded-lg text-faint shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
              >
                <Plus size={18} />
              </button>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
