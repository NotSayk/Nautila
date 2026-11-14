import { useEffect, useRef, useState } from "react";
import { DAY_WIDTH, shiftSpan, timelineTicks, type Zoom } from "../../data/dbcalendar";
import { dayDiff, isoDay, spanOfValue, writeSpan } from "../../data/dbdate";
import { dayNoon, timelineBounds, type Row } from "../../data/dbquery";
import { useT, type Key } from "../../i18n";
import { AddRow, MissingProp } from "./Parts";
import type { Api } from "./shared";

const DAY_MS = 86_400_000;
const ROW = 40;
const ZOOMS: [Zoom, Key][] = [
  ["day", "zoomDay"],
  ["week", "zoomWeek"],
  ["month", "zoomMonth"],
];

type Mode = "move" | "start" | "end";
type Drag = { id: string; mode: Mode; days: number };

export function TimelineView({ api }: { api: Api }) {
  const t = useT();
  const startProp = api.props.find((p) => p.id === api.view.dateProp && p.type === "date");
  const endProp = api.props.find((p) => p.id === api.view.endProp && p.type === "date");
  const zoom: Zoom = api.view.zoom ?? "day";
  const px = DAY_WIDTH[zoom];
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ x: number; moved: boolean; mode: Mode; id: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Les dates invalides sont ignorées (la ligne compte comme sans date).
  const dated = startProp
    ? api.rows.flatMap((row) => {
        const span = spanOfValue(row.props[startProp.id], endProp ? row.props[endProp.id] : undefined);
        return span ? [{ row, ...span }] : [];
      })
    : [];
  const today = isoDay(new Date());
  // La frise couvre toutes les lignes, avec une marge ; elle est bornée autour d'aujourd'hui.
  const { from, to } = timelineBounds(
    dated.map((i) => ({ start: dayNoon(i.start)!, end: dayNoon(i.end)! })),
    dayNoon(today)!,
  );
  const fromDay = isoDay(new Date(from));
  const count = Math.round((to - from) / DAY_MS) + 1;
  const todayX = dayDiff(fromDay, today) * px;

  // À l'ouverture et au changement d'échelle, la frise se place sur aujourd'hui.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, startProp?.id]);

  if (!startProp) return <MissingProp api={api} types={["date"]} field="dateProp" />;

  const { top, bottom } = timelineTicks(fromDay, count, zoom, api.lang, api.ctx.weekStart);
  const inRange = dated.filter((i) => dayDiff(fromDay, i.end) >= 0 && dayDiff(fromDay, i.start) < count);
  const undated = api.rows.length - dated.length;
  const outOfRange = dated.length - inRange.length;

  const commit = (row: Row, start: string, end: string) => {
    const next = writeSpan(
      row.props[startProp.id],
      endProp ? row.props[endProp.id] : undefined,
      start,
      end,
      !!endProp,
    );
    void api.setValues(row, {
      [startProp.id]: next.date,
      ...(endProp ? { [endProp.id]: next.end ?? null } : {}),
    });
  };

  /** Gestes d'une barre ou d'une de ses poignées : déplacer, ou changer le début ou la fin. */
  const gesture = (item: { row: Row; start: string; end: string }, mode: Mode) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { x: e.clientX, moved: false, mode, id: item.row.id };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = press.current;
      if (!p || p.id !== item.row.id || p.mode !== mode) return;
      const dx = e.clientX - p.x;
      if (Math.abs(dx) > 3) p.moved = true;
      if (p.moved) setDrag({ id: item.row.id, mode, days: Math.round(dx / px) });
    },
    onPointerUp: () => {
      const p = press.current;
      press.current = null;
      if (!p || p.id !== item.row.id || p.mode !== mode) return;
      const days = drag?.id === item.row.id && drag.mode === mode ? drag.days : 0;
      setDrag(null);
      if (!p.moved) {
        if (mode === "move") api.peek(item.row.id);
        return;
      }
      if (days === 0) return;
      const next = shiftSpan(item.start, item.end, mode, days);
      commit(item.row, next.start, next.end);
    },
    onPointerCancel: () => {
      press.current = null;
      setDrag(null);
    },
  });

  return (
    <div>
      <div role="group" aria-label={t("zoomLabel")} className="mb-2 flex w-fit rounded-md bg-hover p-0.5">
        {ZOOMS.map(([z, key]) => (
          <button
            key={z}
            aria-pressed={zoom === z}
            onClick={() => api.patchView({ zoom: z === "day" ? undefined : z })}
            className={`h-6 rounded px-2.5 text-[13px] ${zoom === z ? "bg-pop font-medium shadow-[0_0_0_1px_var(--color-line)]" : "text-muted"}`}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <div ref={scroller} className="overflow-x-auto pb-2">
        <div className="relative" style={{ width: count * px }}>
          <div className="relative h-6 text-xs text-muted">
            {top.map((tick) => (
              <span
                key={tick.offset}
                className="absolute top-0 overflow-hidden whitespace-nowrap pl-1"
                style={{ left: tick.offset * px, width: tick.days * px }}
              >
                {tick.days * px >= 40 ? tick.label : ""}
              </span>
            ))}
          </div>
          <div className="relative h-6 text-xs text-faint shadow-[inset_0_-1px_0_var(--color-line)]">
            {bottom.map((tick) => (
              <span
                key={tick.offset}
                className="absolute top-0 overflow-hidden whitespace-nowrap pl-1 shadow-[inset_1px_0_0_var(--color-line)]"
                style={{ left: tick.offset * px, width: tick.days * px }}
              >
                {tick.days * px >= 24 ? tick.label : ""}
              </span>
            ))}
          </div>
          <div className="relative" style={{ height: Math.max(inRange.length, 1) * ROW + 8 }}>
            {todayX >= 0 && todayX <= count * px && (
              <div
                aria-hidden
                className="absolute top-0 h-full w-px bg-danger"
                style={{ left: todayX + Math.round(px / 2) }}
              />
            )}
            {inRange.map((item, i) => {
              const shifted =
                drag?.id === item.row.id ? shiftSpan(item.start, item.end, drag.mode, drag.days) : item;
              const left = dayDiff(fromDay, shifted.start) * px;
              const width = Math.max((dayDiff(shifted.start, shifted.end) + 1) * px, 16);
              const label = `${item.row.icon ?? ""} ${item.row.title || t("untitled")}`.trim();
              return (
                <div
                  key={item.row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") api.peek(item.row.id);
                    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      const d = e.key === "ArrowRight" ? 1 : -1;
                      const next = shiftSpan(item.start, item.end, e.shiftKey ? "end" : "move", d);
                      commit(item.row, next.start, next.end);
                    }
                  }}
                  className={`group/bar absolute flex h-8 touch-pan-y items-center rounded-md bg-pop text-left text-[13px] font-medium shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)] hover:bg-hover ${
                    drag?.id === item.row.id ? "cursor-grabbing opacity-80" : "cursor-grab"
                  }`}
                  style={{ top: 8 + i * ROW, left, width }}
                  {...gesture(item, "move")}
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-2 cursor-ew-resize touch-none rounded-l-md hover:bg-accent/30"
                    {...gesture(item, "start")}
                  />
                  <span
                    className={`pointer-events-none truncate px-2 ${width < 90 ? "absolute left-full whitespace-nowrap" : ""}`}
                  >
                    {label}
                  </span>
                  <span
                    aria-hidden
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize touch-none rounded-r-md hover:bg-accent/30"
                    {...gesture(item, "end")}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {undated > 0 && (
        <p className="mt-2 text-xs text-faint">
          {undated} {t("noDate")}
        </p>
      )}
      {outOfRange > 0 && (
        <p className="mt-2 text-xs text-faint">
          {outOfRange} {t("outOfRange")}
        </p>
      )}
      <AddRow onClick={() => api.add({ [startProp.id]: today })} />
    </div>
  );
}
