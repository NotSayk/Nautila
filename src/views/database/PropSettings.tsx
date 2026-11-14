import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { getDatabase } from "../../data/databases";
import type { NumberFormat, Prop, RollupFn } from "../../data/dbquery";
import { useT, type Key } from "../../i18n";
import { useStore } from "../../store";
import { FormulaField } from "./FormulaHelp";
import { OptionsEditor } from "./OptionsEditor";
import { FIELD, type Api } from "./shared";

const FORMATS: [NumberFormat, Key][] = [
  ["number", "fmtNumber"],
  ["percent", "fmtPercent"],
  ["eur", "fmtEur"],
  ["usd", "fmtUsd"],
];
const ROLLUPS: [RollupFn, Key][] = [
  ["count", "rfCount"],
  ["sum", "rfSum"],
  ["avg", "rfAvg"],
  ["min", "rfMin"],
  ["max", "rfMax"],
  ["list", "rfList"],
];

/** Propriétés de la base liée par une relation, pour choisir ce que le cumul agrège. */
function useTargetProps(target: string | undefined) {
  const [props, setProps] = useState<Prop[]>([]);
  useEffect(() => {
    let live = true;
    setProps([]);
    if (target) void getDatabase(target).then((c) => live && setProps(c?.props ?? []));
    return () => {
      live = false;
    };
  }, [target]);
  return props;
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="px-1 text-xs text-faint">{label}</span>
      {children}
    </label>
  );
}

function RollupSettings({ prop, api }: { prop: Prop; api: Api }) {
  const t = useT();
  const relations = api.props.filter((p) => p.type === "relation");
  const relation = relations.find((r) => r.id === prop.rollupRelation);
  const targetProps = useTargetProps(relation?.target);
  if (relations.length === 0) return <p className="px-1 text-muted">{t("noRelationProp")}</p>;
  return (
    <div className="space-y-1.5">
      <Labeled label={t("rollupRelation")}>
        <select
          value={prop.rollupRelation ?? ""}
          className={`${FIELD} w-full`}
          onChange={(e) => api.updateProp(prop.id, { rollupRelation: e.target.value || undefined, rollupProp: undefined })}
        >
          <option value="" />
          {relations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label={t("rollupProp")}>
        <select
          value={prop.rollupProp ?? ""}
          className={`${FIELD} w-full`}
          onChange={(e) => api.updateProp(prop.id, { rollupProp: e.target.value || undefined })}
        >
          <option value="" />
          <option value="title">{t("name")}</option>
          {targetProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label={t("rollupFn")}>
        <select
          value={prop.rollupFn ?? "count"}
          className={`${FIELD} w-full`}
          onChange={(e) => api.updateProp(prop.id, { rollupFn: e.target.value as RollupFn })}
        >
          {ROLLUPS.map(([fn, key]) => (
            <option key={fn} value={fn}>
              {t(key)}
            </option>
          ))}
        </select>
      </Labeled>
    </div>
  );
}

/** Réglages propres au type d'une propriété : format, formule, relation, cumul, options. */
export function PropSettings({ prop, api }: { prop: Prop; api: Api }) {
  const t = useT();
  const databases = useStore((s) => s.pages).filter((p) => p.kind === "database");
  const [editing, setEditing] = useState(false);

  switch (prop.type) {
    case "number":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Labeled label={t("numberFormat")}>
            <select
              value={prop.format ?? "number"}
              className={`${FIELD} w-full`}
              onChange={(e) =>
                api.updateProp(prop.id, { format: e.target.value === "number" ? undefined : (e.target.value as NumberFormat) })
              }
            >
              {FORMATS.map(([format, key]) => (
                <option key={format} value={format}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label={t("decimals")}>
            <select
              value={prop.decimals ?? ""}
              className={`${FIELD} w-full`}
              onChange={(e) => api.updateProp(prop.id, { decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
            >
              <option value="">{t("decimalsAuto")}</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Labeled>
        </div>
      );
    case "formula":
      return <FormulaField prop={prop} props={api.props} onChange={(formula) => api.updateProp(prop.id, { formula })} />;
    case "relation":
      return (
        <div className="space-y-1.5">
          <Labeled label={t("relatedDb")}>
            <select
              value={prop.target ?? ""}
              // Le lien miroir est propre à la base liée : on ne la change pas tant qu'il existe.
              disabled={!!prop.twin}
              onChange={(e) => api.updateProp(prop.id, { target: e.target.value })}
              className={`${FIELD} w-full disabled:opacity-60`}
            >
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || t("untitled")}
                </option>
              ))}
            </select>
          </Labeled>
          <label className="flex min-h-7 items-start gap-2 px-1 py-1">
            <input
              type="checkbox"
              checked={!!prop.twin}
              disabled={!prop.target}
              onChange={(e) => void api.setTwin(prop.id, e.target.checked)}
              className="mt-0.5 size-4 accent-(--color-accent)"
            />
            <span>
              {t("bidirectional")}
              <span className="block text-xs text-faint">{t("bidirectionalHint")}</span>
            </span>
          </label>
        </div>
      );
    case "rollup":
      return <RollupSettings prop={prop} api={api} />;
    case "select":
    case "multi_select":
      return (
        <div>
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
            className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-muted hover:bg-hover"
          >
            <Pencil size={14} />
            {t("editOptions")}
          </button>
          {editing && (
            <div className="mt-1 max-h-60 overflow-y-auto">
              <OptionsEditor options={prop.options ?? []} onChange={(options) => api.setOptions(prop.id, options)} />
            </div>
          )}
        </div>
      );
    default:
      return null;
  }
}
