import { Fragment } from "react";
import { useT } from "../../i18n";
import { PageIcon } from "../common";
import { AddRow, CardProps, GroupHeader, groupPreset, isCollapsed, RowMenu } from "./Parts";
import { REVEAL, type Api } from "./shared";

export function ListView({ api }: { api: Api }) {
  const t = useT();
  const groups = api.groups ?? [{ key: "", rows: api.rows }];
  const grouped = api.groups !== null;
  return (
    <div>
      {groups.map((group) => (
        <Fragment key={group.key || "all"}>
          {grouped && <GroupHeader group={group} api={api} />}
          {!(grouped && isCollapsed(api, group)) && (
            <>
              {group.rows.map((row, i) => (
                <div key={row.id} className="group flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-hover">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                    onClick={() => api.peek(row.id)}
                  >
                    <PageIcon page={{ icon: row.icon, kind: "note" }} />
                    <span className="truncate font-medium">
                      {row.title || <span className="text-faint">{t("untitled")}</span>}
                    </span>
                  </button>
                  <span className="flex min-w-0 shrink items-center gap-3 text-[13px] max-sm:hidden">
                    <CardProps row={row} api={api} skip={api.groupProp?.id} />
                  </span>
                  <span className={REVEAL}>
                    <RowMenu row={row} api={api} index={i} count={group.rows.length} />
                  </span>
                </div>
              ))}
              <AddRow onClick={() => api.add(groupPreset(api, group))} />
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}
