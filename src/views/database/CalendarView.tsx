import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { eventsOn, layoutWeek, monthGrid, type DayEvent } from "../../data/dbcalendar";
import { addDays, dayDiff, isoDay, spanOfValue, writeSpan } from "../../data/dbdate";
import type { Row } from "../../data/dbquery";
import { useT } from "../../i18n";
import { IconButton, Popover } from "../common";
import { MissingProp } from "./Parts";
import type { Api } from "./shared";

/** Vrai sur un écran étroit : moins de lignes d'événements par semaine. */
function useNarrow() {
  const query = "(max-width: 640px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function CalendarView({ api }: { api: Api }) {
  const t = useT();
  const narrow = useNarrow();
  const dateProp = api.props.find((p) => p.id === api.view.dateProp && p.type === "date");
  const endProp = api.props.find((p) => p.id === api.view.endProp && p.type === "date");
  const first = api.ctx.weekStart;
  const [month, setMonth] = useState(() => `${isoDay(new Date()).slice(0, 7)}-01`);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [more, setMore] = useState<{ day: string; anchor: DOMRect } | null>(null);
  const maxLanes = narrow ? 2 : 3;

  const byId = useMemo(() => new Map(api.rows.map((r) => [r.id, r])), [api.rows]);
  const events = useMemo<DayEvent[]>(() => {
    if (!dateProp) return [];
    return api.rows.flatMap((row) => {
      const span = spanOfValue(row.props[dateProp.id], endProp ? row.props[endProp.id] : undefined);
      return span ? [{ id: row.id, ...span }] : [];
    });
  }, [api.rows, dateProp, endProp]);

  if (!dateProp) return <MissingProp api={api} types={["date"]} field="dateProp" />;

  const days = monthGrid(month, first);
  const weeks = Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const today = isoDay(new Date());
  const weekday = new Intl.DateTimeFormat(api.lang, { weekday: narrow ? "narrow" : "short" });
  const monthLabel = new Intl.DateTimeFormat(api.lang, { month: "long", year: "numeric" }).format(
    new Date(`${month}T12:00:00`),
  );
  const shift = (n: number) => {
    const d = new Date(`${month}T12:00:00`);
    setMonth(isoDay(new Date(d.getFullYear(), d.getMonth() + n, 1)));
  };

  /** Déplace l'événement sur un autre jour, en gardant sa durée. */
  const moveTo = (row: Row, day: string) => {
    const event = events.find((e) => e.id === row.id);
    if (!event || event.start === day) return;
    const length = dayDiff(event.start, event.end);
    const next = writeSpan(
      row.props[dateProp.id],
      endProp ? row.props[endProp.id] : undefined,
      day,
      addDays(day, length),
      !!endProp,
    );
    void api.setValues(row, {
      [dateProp.id]: next.date,
      ...(endProp ? { [endProp.id]: next.end ?? null } : {}),
    });
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <span className="flex-1 font-semibold first-letter:uppercase">{monthLabel}</span>
        <IconButton label={t("previous")} onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <button
          className="h-7 rounded-md px-2 text-muted hover:bg-hover"
          onClick={() => setMonth(`${today.slice(0, 7)}-01`)}
        >
          {t("today")}
        </button>
        <IconButton label={t("next")} onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 text-xs text-faint">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="px-1 pb-1 text-right sm:px-2">
            {weekday.format(new Date(`${d}T12:00:00`))}
          </span>
        ))}
      </div>
      <div className="shadow-[inset_1px_1px_0_var(--color-line)]">
        {weeks.map((week) => {
          const { segments, hidden } = layoutWeek(events, week, maxLanes);
          return (
            <div
              key={week[0]}
              className="grid grid-cols-7"
              style={{ gridTemplateRows: `28px repeat(${maxLanes}, 22px) 20px` }}
            >
              {week.map((day, c) => (
                <div
                  key={day}
                  style={{ gridColumn: c + 1, gridRow: "1 / -1" }}
                  className={`group min-h-24 p-0.5 shadow-[inset_-1px_-1px_0_var(--color-line)] sm:p-1 ${
                    day.slice(0, 7) === month.slice(0, 7) ? "" : "bg-panel"
                  } ${overDay === day ? "bg-hover" : ""}`}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOverDay(day);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const row = dragId ? byId.get(dragId) : undefined;
                    if (row) moveTo(row, day);
                    setDragId(null);
                    setOverDay(null);
                  }}
                >
                  <div className="flex h-6 items-center justify-between">
                    <button
                      aria-label={`${t("newRow")} ${day}`}
                      onClick={() => api.add({ [dateProp.id]: day })}
                      className="grid size-5 place-items-center rounded text-faint opacity-0 hover:bg-hover focus:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 max-sm:hidden"
                    >
                      <Plus size={13} />
                    </button>
                    <span
                      className={`ml-auto grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs ${
                        day === today ? "bg-danger font-medium text-white" : "text-muted"
                      }`}
                    >
                      {Number(day.slice(8))}
                    </span>
                  </div>
                </div>
              ))}
              {segments.map((seg) => {
                const row = byId.get(seg.id);
                if (!row) return null;
                return (
                  <button
                    key={`${seg.id}-${seg.col}`}
                    draggable
                    onDragStart={() => setDragId(row.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverDay(null);
                    }}
                    onClick={() => api.peek(row.id)}
                    title={row.title || t("untitled")}
                    style={{ gridColumn: `${seg.col + 1} / span ${seg.span}`, gridRow: seg.lane + 2 }}
                    className={`relative z-10 mx-0.5 my-px truncate bg-pop px-1 text-left text-xs font-medium shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover ${
                      seg.clippedStart ? "rounded-l-none" : "rounded-l"
                    } ${seg.clippedEnd ? "rounded-r-none" : "rounded-r"} ${dragId === row.id ? "opacity-40" : ""}`}
                  >
                    {row.icon} {row.title || t("untitled")}
                  </button>
                );
              })}
              {hidden.map(
                (n, c) =>
                  n > 0 && (
                    <button
                      key={week[c]}
                      style={{ gridColumn: c + 1, gridRow: maxLanes + 2 }}
                      onClick={(e) => setMore({ day: week[c], anchor: e.currentTarget.getBoundingClientRect() })}
                      className="relative z-10 mx-0.5 h-5 truncate rounded px-1 text-left text-xs text-muted hover:bg-hover"
                    >
                      {t("moreEvents").replace("{n}", String(n))}
                    </button>
                  ),
              )}
            </div>
          );
        })}
      </div>
      {more && (
        <Popover anchor={more.anchor} onClose={() => setMore(null)} width={240}>
          <p className="px-2 py-1 text-xs text-faint">
            {new Intl.DateTimeFormat(api.lang, { weekday: "long", day: "numeric", month: "long" }).format(
              new Date(`${more.day}T12:00:00`),
            )}
          </p>
          {eventsOn(events, more.day).map((e) => {
            const row = byId.get(e.id);
            return (
              row && (
                <button
                  key={e.id}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                  onClick={() => {
                    setMore(null);
                    api.peek(row.id);
                  }}
                >
                  <span className="truncate">
                    {row.icon} {row.title || t("untitled")}
                  </span>
                </button>
              )
            );
          })}
        </Popover>
      )}
    </div>
  );
}
