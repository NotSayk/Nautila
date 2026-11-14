import { ExternalLink, Paperclip, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatNumber } from "../../data/dbcalc";
import { formatDateValue, parseDateValue, serializeDate } from "../../data/dbdate";
import { OPTION_COLORS, type Option, type Prop, type Value } from "../../data/dbquery";
import { linkHref } from "../../data/dbview";
import { attachFile, fileInfos } from "../../data/databases";
import { MAX_FILE_BYTES, resolveFileUrl } from "../../data/files";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { Popover } from "../common";
import { OptionsEditor } from "./OptionsEditor";

const INPUT = "h-full w-full min-w-0 bg-transparent px-2 placeholder:text-faint";

/** Date lisible d'un jour « AAAA-MM-JJ » (conservée pour les appelants existants). */
export function formatDate(iso: string, lang: string) {
  return formatDateValue(iso, lang);
}

const isBlank = (v: Value) => v == null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

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

/** Texte d'un résultat calculé (formule, cumul) ou d'un nombre, selon le format de la propriété. */
export function computedText(prop: Prop, value: Value, lang: string): string {
  if (typeof value === "number") return formatNumber(value, prop.type === "number" ? prop : undefined, lang);
  return typeof value === "string" ? value : "";
}

/** Affichage en lecture seule d'une valeur (cartes, listes). Rien si elle est vide. */
export function PropValue({ prop, value }: { prop: Prop; value: Value }) {
  const lang = useStore((s) => s.lang);
  if (isBlank(value)) return null;
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
    case "created_time":
    case "last_edited_time":
      return <span className="text-muted">{formatDateValue(value, lang)}</span>;
    case "relation":
      return (
        <span className="flex flex-wrap gap-1">
          <Related ids={value as string[]} />
        </span>
      );
    case "files":
      return (
        <span className="inline-flex items-center gap-1 text-muted">
          <Paperclip size={12} />
          {Array.isArray(value) ? value.length : 0}
        </span>
      );
    case "number":
    case "formula":
    case "rollup":
      return <span className="truncate text-muted">{computedText(prop, value, lang)}</span>;
    default:
      return <span className="truncate text-muted">{String(value)}</span>;
  }
}

/** Lignes liées, affichées comme des liens vers leur page. */
function Related({ ids }: { ids: string[] }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const navigate = useStore((s) => s.navigate);
  return (
    <>
      {ids.map((id) => {
        const page = pages.find((p) => p.id === id);
        return (
          page && (
            <span
              key={id}
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                navigate({ view: "page", id });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                e.stopPropagation();
                navigate({ view: "page", id });
              }}
              className="max-w-full cursor-pointer truncate rounded px-1 font-medium underline decoration-line underline-offset-4 hover:bg-hover"
            >
              {page.icon} {page.title || t("untitled")}
            </span>
          )
        );
      })}
    </>
  );
}

function RelationEditor({ prop, value, onChange }: { prop: Prop; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const selected = Array.isArray(value) ? value : [];
  const rows = pages.filter(
    (p) => p.parent_id === prop.target && (p.title || t("untitled")).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={prop.name}
        className="flex h-full min-h-8 w-full cursor-pointer flex-wrap items-center gap-1 px-2 py-1"
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onKeyDown={(e) =>
          e.target === e.currentTarget && e.key === "Enter" && setAnchor(e.currentTarget.getBoundingClientRect())
        }
      >
        <Related ids={selected} />
      </div>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={260}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("relationSearch")}
            className="mb-1 h-7 w-full rounded bg-hover px-2 placeholder:text-faint"
          />
          <div className="max-h-56 overflow-y-auto">
            {rows.length === 0 && <p className="px-2 py-1 text-muted">{t("noResults")}</p>}
            {rows.map((r) => (
              <button
                key={r.id}
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                onClick={() =>
                  onChange(selected.includes(r.id) ? selected.filter((x) => x !== r.id) : [...selected, r.id])
                }
              >
                <span className="min-w-0 flex-1 truncate">
                  {r.icon} {r.title || t("untitled")}
                </span>
                {selected.includes(r.id) && <span className="text-muted">✓</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
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
  const [editing, setEditing] = useState(false);
  const multi = prop.type === "multi_select";
  const options = prop.options ?? [];
  const selected = Array.isArray(value) ? value : value ? [String(value)] : [];
  const q = query.trim();
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const exact = options.find((o) => o.name.toLowerCase() === q.toLowerCase());

  const close = () => {
    setAnchor(null);
    setEditing(false);
    setQuery("");
  };
  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else {
      onChange(selected[0] === id ? null : id);
      close();
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
    if (!multi) close();
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
        <Popover anchor={anchor} onClose={close} width={260}>
          {editing ? (
            <div className="max-h-72 overflow-y-auto">
              <OptionsEditor
                options={options}
                onChange={(next) => {
                  onOptions(next);
                  // La cellule courante perd les options retirées ; les autres lignes sont nettoyées par le parent.
                  const kept = selected.filter((id) => next.some((o) => o.id === id));
                  if (kept.length !== selected.length) onChange(multi ? (kept.length ? kept : null) : (kept[0] ?? null));
                }}
              />
            </div>
          ) : (
            <>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && q && (exact ? toggle(exact.id) : create())}
                placeholder={t("optionSearch")}
                className="mb-1 h-7 w-full rounded bg-hover px-2 placeholder:text-faint"
              />
              <div className="max-h-56 overflow-y-auto">
                {shown.map((o) => (
                  <button
                    key={o.id}
                    className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                    onClick={() => toggle(o.id)}
                  >
                    <span className={`tag tag-${o.color} truncate`}>{o.name}</span>
                    {selected.includes(o.id) && <span className="text-muted">✓</span>}
                  </button>
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
            </>
          )}
          <div className="mt-1 border-t border-line pt-1">
            <button
              className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-muted hover:bg-hover"
              onClick={() => setEditing(!editing)}
            >
              <Pencil size={13} />
              {editing ? t("close") : t("editOptions")}
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

const timeOf = (v: string) => (v.length > 10 ? v.slice(11) : "");

/** Date, avec heure facultative et date de fin facultative. */
function DateEditor({ prop, value, onChange }: { prop: Prop; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const range = parseDateValue(value);
  const [withEnd, setWithEnd] = useState(false);
  const [withTime, setWithTime] = useState(false);
  const startDay = range?.start.slice(0, 10) ?? "";
  const endDay = range?.end?.slice(0, 10) ?? "";

  const open = (rect: DOMRect) => {
    setWithEnd(!!range?.end);
    setWithTime(!!range?.time);
    setAnchor(rect);
  };
  // Écrit la valeur à partir des morceaux ; un début vide efface la date.
  const write = (parts: { day: string; time?: string; end?: string; endTime?: string }, timed = withTime, ranged = withEnd) => {
    if (!parts.day) return onChange(null);
    const full = (day: string, time?: string) => (timed ? `${day}T${time || "09:00"}` : day);
    const from = full(parts.day, parts.time);
    const to = ranged && parts.end && parts.end >= parts.day ? full(parts.end, parts.endTime) : null;
    onChange(serializeDate(from, to));
  };
  const current = {
    day: startDay,
    time: timeOf(range?.start ?? ""),
    end: endDay,
    endTime: timeOf(range?.end ?? ""),
  };

  return (
    <>
      <button
        aria-label={prop.name}
        className="flex h-full min-h-8 w-full items-center px-2 text-left"
        onClick={(e) => open(e.currentTarget.getBoundingClientRect())}
      >
        {value ? formatDateValue(value, lang) : null}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={270}>
          <div className="space-y-1.5 p-1">
            <div className="flex gap-1">
              <input
                autoFocus
                type="date"
                aria-label={prop.name}
                value={startDay}
                onChange={(e) => write({ ...current, day: e.target.value })}
                className="h-8 min-w-0 flex-1 rounded bg-hover px-1.5"
              />
              {withTime && (
                <input
                  type="time"
                  aria-label={t("timeOfDay")}
                  value={current.time || "09:00"}
                  onChange={(e) => write({ ...current, time: e.target.value })}
                  className="h-8 w-24 rounded bg-hover px-1.5"
                />
              )}
            </div>
            {withEnd && (
              <div className="flex gap-1">
                <input
                  type="date"
                  aria-label={t("endDate")}
                  min={startDay}
                  value={endDay}
                  onChange={(e) => write({ ...current, end: e.target.value })}
                  className="h-8 min-w-0 flex-1 rounded bg-hover px-1.5"
                />
                {withTime && (
                  <input
                    type="time"
                    aria-label={t("timeOfDay")}
                    value={current.endTime || "10:00"}
                    onChange={(e) => write({ ...current, endTime: e.target.value })}
                    className="h-8 w-24 rounded bg-hover px-1.5"
                  />
                )}
              </div>
            )}
            <label className="flex h-7 items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={withEnd}
                onChange={(e) => {
                  setWithEnd(e.target.checked);
                  if (!e.target.checked) write(current, withTime, false);
                }}
                className="size-4 accent-(--color-accent)"
              />
              {t("endDate")}
            </label>
            <label className="flex h-7 items-center gap-2 px-1">
              <input
                type="checkbox"
                checked={withTime}
                onChange={(e) => {
                  setWithTime(e.target.checked);
                  write(current, e.target.checked, withEnd);
                }}
                className="size-4 accent-(--color-accent)"
              />
              {t("includeTime")}
            </label>
            {value ? (
              <button
                className="flex h-7 w-full items-center rounded px-1 text-left text-muted hover:bg-hover"
                onClick={() => {
                  onChange(null);
                  setAnchor(null);
                }}
              >
                {t("clearDate")}
              </button>
            ) : null}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Valide à Entrée, annule à Échap. */
function finish(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
  else if (e.key === "Escape") {
    e.currentTarget.value = e.currentTarget.defaultValue;
    e.currentTarget.blur();
  }
}

function NumberEditor({ prop, value, onChange }: { prop: Prop; value: Value; onChange: (v: Value) => void }) {
  const lang = useStore((s) => s.lang);
  const raw = typeof value === "number" ? String(value) : "";
  const shown = typeof value === "number" ? formatNumber(value, prop, lang) : "";
  return (
    <input
      key={`${shown}|${prop.format}|${prop.decimals}`}
      aria-label={prop.name}
      inputMode="decimal"
      defaultValue={shown}
      // On édite le nombre brut ; le format ne s'applique qu'à l'affichage.
      onFocus={(e) => {
        e.target.value = raw;
        e.target.select();
      }}
      onBlur={(e) => {
        const text = e.target.value.trim().replace(",", ".");
        const n = Number(text);
        const next = text === "" || Number.isNaN(n) ? null : n;
        if (next !== (value ?? null)) onChange(next);
        else e.target.value = shown;
      }}
      onKeyDown={(e) => {
        // Échap rend le nombre brut d'origine, que le blur reconnaît comme inchangé.
        if (e.key === "Escape") e.currentTarget.value = raw;
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      className={`${INPUT} min-h-8 tabular-nums`}
    />
  );
}

/** Texte, lien, e-mail ou téléphone ; les trois derniers ouvrent leur lien d'un clic. */
function TextEditor({ prop, value, onChange }: { prop: Prop; value: Value; onChange: (v: Value) => void }) {
  const t = useT();
  const href = linkHref(prop.type, value);
  return (
    <span className="group/url flex h-full min-h-8 items-center">
      <input
        key={String(value ?? "")}
        aria-label={prop.name}
        defaultValue={typeof value === "string" ? value : ""}
        onBlur={(e) => e.target.value !== (value ?? "") && onChange(e.target.value || null)}
        onKeyDown={finish}
        className={`${INPUT} ${href ? "underline decoration-line underline-offset-4" : ""}`}
      />
      {href && (
        <a
          href={href}
          target={prop.type === "url" ? "_blank" : undefined}
          rel="noreferrer noopener"
          aria-label={`${t("open")} : ${String(value)}`}
          title={String(value)}
          className="mr-1 grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-active md:hidden md:group-focus-within/url:grid md:group-hover/url:grid"
        >
          <ExternalLink size={14} />
        </a>
      )}
    </span>
  );
}

/** Noms des fichiers joints, d'après leur adresse. */
function useFileInfos(urls: string[]) {
  const [infos, setInfos] = useState<Map<string, { name: string; mime: string }>>(new Map());
  const key = urls.join("|");
  useEffect(() => {
    let live = true;
    if (urls.length) void fileInfos(urls).then((m) => live && setInfos(m));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return infos;
}

function FilesEditor({
  prop,
  value,
  rowId,
  onChange,
}: {
  prop: Prop;
  value: Value;
  rowId?: string;
  onChange: (v: Value) => void;
}) {
  const t = useT();
  const urls = Array.isArray(value) ? value : [];
  const infos = useFileInfos(urls);
  const add = async (files: FileList | null) => {
    if (!files || !rowId) return;
    const added: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        useStore.setState({ toast: { message: t("fileTooBig") } });
        continue;
      }
      try {
        added.push(await attachFile(rowId, file));
      } catch {
        useStore.setState({ toast: { message: t("fileError") } });
      }
    }
    if (added.length) onChange([...urls, ...added]);
  };
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 px-2 py-1">
      {urls.map((url) => (
        <span key={url} className="inline-flex max-w-full items-center rounded bg-hover">
          <button
            className="max-w-40 truncate px-1.5 text-[13px] hover:underline"
            onClick={async () => window.open(await resolveFileUrl(url), "_blank", "noopener")}
          >
            {infos.get(url)?.name ?? t("propFiles")}
          </button>
          <button
            aria-label={t("delete")}
            title={t("delete")}
            className="grid size-5 place-items-center rounded text-muted hover:bg-active"
            onClick={() => onChange(urls.filter((u) => u !== url))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {rowId && (
        <label
          title={t("attachFile")}
          className="grid size-6 cursor-pointer place-items-center rounded text-muted focus-within:outline-2 hover:bg-hover"
        >
          <Paperclip size={14} />
          <input
            type="file"
            multiple
            aria-label={`${prop.name} : ${t("attachFile")}`}
            className="sr-only"
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

/** Champ d'édition d'une valeur, selon le type de la propriété. `rowId` sert aux fichiers joints. */
export function PropEditor({
  prop,
  value,
  rowId,
  onChange,
  onOptions,
}: {
  prop: Prop;
  value: Value;
  rowId?: string;
  onChange: (v: Value) => void;
  onOptions: (options: Option[]) => void;
}) {
  const lang = useStore((s) => s.lang);
  switch (prop.type) {
    case "formula":
    case "rollup":
      return (
        <span className="flex h-full min-h-8 items-center px-2 tabular-nums text-muted">
          {computedText(prop, value, lang)}
        </span>
      );
    case "created_time":
    case "last_edited_time":
      return (
        <span className="flex h-full min-h-8 items-center px-2 text-muted">
          {value ? formatDateValue(value, lang) : ""}
        </span>
      );
    case "relation":
      return <RelationEditor prop={prop} value={value} onChange={onChange} />;
    case "select":
    case "multi_select":
      return <SelectEditor prop={prop} value={value} onChange={onChange} onOptions={onOptions} />;
    case "files":
      return <FilesEditor prop={prop} value={value} rowId={rowId} onChange={onChange} />;
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
      return <DateEditor prop={prop} value={value} onChange={onChange} />;
    case "number":
      return <NumberEditor prop={prop} value={value} onChange={onChange} />;
    default:
      return <TextEditor prop={prop} value={value} onChange={onChange} />;
  }
}
