import { useEffect, useMemo, useState } from "react";
import { rollupTargets, withComputed, type RelatedBase } from "../../data/dbcalc";
import { getDatabase, listRows, loadRelated, purgeOptions, saveDatabase, setRowProps, syncTwin } from "../../data/databases";
import { storedValues, type DbConfig, type Option, type Prop, type Row, type Value } from "../../data/dbquery";
import type { PageMeta } from "../../data/pages";
import { PropEditor } from "./Cells";
import { LINE } from "./shared";

/** Liste « nom de la propriété : valeur » d'une ligne, modifiable. */
export function RowFieldList({
  props,
  row,
  onValue,
  onOptions,
}: {
  props: Prop[];
  row: Row;
  onValue: (prop: Prop, value: Value) => void;
  onOptions: (prop: Prop, options: Option[]) => void;
}) {
  return (
    <>
      {props.map((p) => (
        <div key={p.id} className="flex min-h-8 items-stretch text-[14px] max-sm:flex-col">
          <span className="flex w-40 shrink-0 items-center truncate text-muted max-sm:h-6 max-sm:text-xs">{p.name}</span>
          <span className="min-w-0 flex-1 rounded hover:bg-hover">
            <PropEditor
              prop={p}
              value={row.props[p.id]}
              rowId={row.id}
              onChange={(v) => onValue(p, v)}
              onOptions={(o) => onOptions(p, o)}
            />
          </span>
        </div>
      ))}
    </>
  );
}

/** Propriétés d'une ligne, affichées en tête de sa page. */
export function RowProperties({ page, databaseId }: { page: PageMeta; databaseId: string }) {
  const [config, setConfig] = useState<DbConfig | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [related, setRelated] = useState<Map<string, RelatedBase>>(new Map());

  useEffect(() => {
    let live = true;
    (async () => {
      const [c, rows] = await Promise.all([getDatabase(databaseId), listRows(databaseId)]);
      const links = c ? await loadRelated(rollupTargets(c.props)) : new Map<string, RelatedBase>();
      if (!live) return;
      setConfig(c);
      setRelated(links);
      setRow(rows.find((r) => r.id === page.id) ?? null);
    })();
    return () => {
      live = false;
    };
  }, [databaseId, page.id]);

  // Valeurs calculées (formules, cumuls, dates) d'après les valeurs saisies.
  const shown = useMemo(() => (config && row ? withComputed([row], config.props, related)[0] : null), [config, row, related]);
  if (!config || !row || !shown || config.props.length === 0) return null;

  return (
    <div className={`mt-3 pb-3 ${LINE}`}>
      <RowFieldList
        props={config.props}
        row={shown}
        onValue={(prop, value) => {
          const before = row.props[prop.id];
          const next = { ...row, props: { ...row.props, [prop.id]: value } };
          setRow(next);
          void setRowProps(page.id, storedValues(next.props, config.props));
          void syncTwin(page.id, prop, before, value);
        }}
        onOptions={(prop, options) => {
          const next = { ...config, props: config.props.map((x) => (x.id === prop.id ? { ...x, options } : x)) };
          const removed = (prop.options ?? []).filter((o) => !options.some((x) => x.id === o.id)).map((o) => o.id);
          setConfig(next);
          void saveDatabase(databaseId, next);
          if (removed.length) void purgeOptions(databaseId, prop.id, removed);
        }}
      />
    </div>
  );
}
