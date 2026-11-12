import { ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { OPTION_COLORS, type Option, type Prop, type Value } from "../../data/dbquery";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { Popover } from "../common";

const INPUT = "h-full w-full min-w-0 bg-transparent px-2 placeholder:text-faint";

export function formatDate(iso: string, lang: string) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function Tags({ prop, value }: { prop: Prop; value: Value }) {
  const ids = Array.isArray(value) ? value : value ? [String(value)] : [];
  return (
    <>
      {ids.map((id) => {
        const option = prop.options?.find((o) => o.id === id);
        return (
          option && (
            <span key={id} className={`tag tag-${option.color} max-w-full truncate`}>
              {option.name}
            </span>
          )
        );
      })}
    </>
  );
}

/** Affichage en lecture seule d'une valeur (cartes, listes). Rien si elle est vide. */
export function PropValue({ prop, value }: { prop: Prop; value: Value }) {
  const lang = useStore((s) => s.lang);
  if (value == null || value === "" || value === false || (Array.isArray(value) && value.length === 0)) return null;
  switch (prop.type) {
    case "select":
    case "multi_select":
      return (
        <span className="flex flex-wrap gap-1">
          <Tags prop={prop} value={value} />
        </span>
      );
    case "checkbox":
      return <span className="text-muted">✓ {prop.name}</span>;
    case "date":
      return <span className="text-muted">{formatDate(String(value), lang)}</span>;
    default:
      return <span className="truncate text-muted">{String(value)}</span>;
  }
}

function SelectEditor({
  prop,
  value,
  onChange,
  onOptions,
}: {
  prop: Prop;
  value: Value;
  onChange: (v: Value) => void;
  onOptions: (options: Option[]) => void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const multi = prop.type === "multi_select";
  const options = prop.options ?? [];
  const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
  const q = query.trim();
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const exact = options.some((o) => o.name.toLowerCase() === q.toLowerCase());

  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? null : id);
      setAnchor(null);
    }
  };
  const create = () => {
    const option = {
      id: crypto.randomUUID().slice(0, 8),
      name: q,
      color: OPTION_COLORS[options.length % OPTION_COLORS.length],
    };
    onOptions([...options, option]);
    onChange(multi ? [...selected, option.id] : option.id);
    setQuery("");
    if (!multi) setAnchor(null);
  };
  const remove = (id: string) => {
    onOptions(options.filter((o) => o.id !== id));
    if (selected.includes(id)) onChange(multi ? selected.filter((x) => x !== id) : null);
  };

  return (
    <>
      <button
        aria-label={prop.name}
        className="flex h-full min-h-8 w-full flex-wrap items-center gap-1 px-2 py-1 text-left"
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <Tags prop={prop} value={value} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={250}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q && (exact ? toggle(shown[0].id) : create())}
            placeholder={t("optionSearch")}
            className="mb-1 h-7 w-full rounded bg-hover px-2 placeholder:text-faint"
          />
          <div className="max-h-56 overflow-y-auto">
            {shown.map((o) => (
              <div key={o.id} className="group flex h-7 items-center rounded hover:bg-hover">
                <button
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
                  onClick={() => toggle(o.id)}
                >
                  <span className={`tag tag-${o.color} truncate`}>{o.name}</span>
                  {selected.includes(o.id) && <span className="text-muted">✓</span>}
                </button>
                <button
                  aria-label={t("delete")}
                  title={t("delete")}
                  className="mr-1 hidden size-5 place-items-center rounded text-muted hover:bg-active group-hover:grid"
                  onClick={() => remove(o.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {q && !exact && (
              <button
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                onClick={create}
              >
                <span className="text-muted">{t("create")}</span>
                <span className="tag tag-gray truncate">{q}</span>
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Champ d'édition d'une valeur, selon le type de la propriété. */
export function PropEditor({
  prop,
  value,
  onChange,
  onOptions,
}: {
  prop: Prop;
  value: Value;
  onChange: (v: Value) => void;
  onOptions: (options: Option[]) => void;
}) {
  switch (prop.type) {
    case "select":
    case "multi_select":
      return <SelectEditor prop={prop} value={value} onChange={onChange} onOptions={onOptions} />;
    case "checkbox":
      return (
        <label className="flex h-full min-h-8 items-center px-2">
          <input
            type="checkbox"
            aria-label={prop.name}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-(--color-accent)"
          />
        </label>
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={prop.name}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={`${INPUT} min-h-8 ${value ? "" : "text-faint"}`}
        />
      );
    case "number":
      return (
        <input
          key={String(value)}
          aria-label={prop.name}
          inputMode="decimal"
          defaultValue={typeof value === "number" ? value : ""}
          onBlur={(e) => {
            const raw = e.target.value.trim().replace(",", ".");
            const n = Number(raw);
            const next = raw === "" || Number.isNaN(n) ? null : n;
            if (next !== (value ?? null)) onChange(next);
            if (next === null) e.target.value = "";
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`${INPUT} min-h-8 tabular-nums`}
        />
      );
    default:
      return (
        <span className="group/url flex h-full min-h-8 items-center">
          <input
            key={String(value ?? "")}
            aria-label={prop.name}
            defaultValue={typeof value === "string" ? value : ""}
            onBlur={(e) => e.target.value !== (value ?? "") && onChange(e.target.value || null)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={`${INPUT} ${prop.type === "url" && value ? "underline decoration-line underline-offset-4" : ""}`}
          />
          {prop.type === "url" && typeof value === "string" && /^https?:\/\//.test(value) && (
            <a
              href={value}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={value}
              className="mr-1 hidden size-6 shrink-0 place-items-center rounded text-muted hover:bg-active group-hover/url:grid"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </span>
      );
  }
}
