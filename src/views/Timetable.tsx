import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCalendar,
  importEvents,
  layoutColumns,
  listCalendars,
  listEvents,
  nextEvent,
  setEventsCourse,
  type CalEvent,
  type CalendarInfo,
} from "../data/events";
import { clock, legacySlotKeys, parseIcal, type IcalCalendar } from "../data/ical";
import { deleteSlot, listSlots, saveSlot, toMinutes, type Slot } from "../data/school";
import { OPTION_COLORS } from "../data/dbquery";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Menu, useOverlay, View } from "./common";
import { confirmDialog } from "./dialogs";

const HOUR = 52;
const FIELD = "h-8 w-full rounded-md bg-hover px-2";
type Draft = Omit<Slot, "id"> & { id?: string };

/** Noms des jours, lundi en premier (le 1er janvier 2024 est un lundi). */
export const dayNames = (lang: string, format: "short" | "long" = "long") =>
  Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(lang, { weekday: format }).format(new Date(2024, 0, 1 + i)),
  );

function SlotDialog({ draft, onClose }: { draft: Draft; onClose: (changed: boolean) => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [slot, setSlot] = useState(draft);
  useOverlay(() => onClose(false));
  const set = (patch: Partial<Draft>) => setSlot((s) => ({ ...s, ...patch }));
  const course = courses.find((c) => c.id === slot.course_id);
  const valid = (slot.title.trim() || course) && toMinutes(slot.end) > toMinutes(slot.start);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => onClose(false)}>
      <form
        role="dialog"
        aria-label={t(draft.id ? "editSlot" : "addSlot")}
        className="w-full max-w-sm space-y-3 rounded-xl bg-pop p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          await saveSlot({ ...slot, title: slot.title.trim() || course?.title || "" });
          onClose(true);
        }}
      >
        <p className="font-semibold">{t(draft.id ? "editSlot" : "addSlot")}</p>
        <label className="block text-xs text-muted">
          {t("course")}
          <select
            value={slot.course_id ?? ""}
            onChange={(e) => set({ course_id: e.target.value || null })}
            className={`${FIELD} mt-1 text-sm text-ink`}
          >
            <option value="">{t("noCourse")}</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || t("untitled")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          {t("taskTitle")}
          <input
            autoFocus
            value={slot.title}
            placeholder={course?.title}
            onChange={(e) => set({ title: e.target.value })}
            className={`${FIELD} mt-1 text-sm text-ink placeholder:text-faint`}
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs text-muted">
            {t("day")}
            <select
              value={slot.day}
              onChange={(e) => set({ day: Number(e.target.value) })}
              className={`${FIELD} mt-1 text-sm text-ink`}
            >
              {dayNames(lang).map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            {t("startTime")}
            <input
              type="time"
              required
              value={slot.start}
              onChange={(e) => set({ start: e.target.value })}
              className={`${FIELD} mt-1 text-sm text-ink`}
            />
          </label>
          <label className="block text-xs text-muted">
            {t("endTime")}
            <input
              type="time"
              required
              value={slot.end}
              onChange={(e) => set({ end: e.target.value })}
              className={`${FIELD} mt-1 text-sm text-ink`}
            />
          </label>
        </div>
        <label className="block text-xs text-muted">
          {t("room")}
          <input
            value={slot.room}
            onChange={(e) => set({ room: e.target.value })}
            className={`${FIELD} mt-1 text-sm text-ink`}
          />
        </label>
        <div className="flex items-center gap-2 pt-1">
          {draft.id && (
            <button
              type="button"
              className="h-8 rounded-md px-2 text-danger hover:bg-hover"
              onClick={async () => {
                await deleteSlot(draft.id!);
                onClose(true);
              }}
            >
              {t("delete")}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="h-8 rounded-md px-3 hover:bg-hover" onClick={() => onClose(false)}>
            {t("cancel")}
          </button>
          <button
            disabled={!valid}
            className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95 disabled:opacity-40"
          >
            {t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}


const pad = (n: number) => String(n).padStart(2, "0");
const DAY = 864e5;

/** Lundi 0 h de la semaine qui contient `at`. */
function startOfWeek(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Minuit, `days` jours plus tard (les changements d'heure sont respectés). */
function addDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

const minutesOf = (at: number) => new Date(at).getHours() * 60 + new Date(at).getMinutes();

/** Couleur d'un cours : celle de sa matière, sinon une couleur tirée de son intitulé. */
function colorFor(courses: { id: string }[], courseId: string | null, title: string): string {
  const index = courses.findIndex((c) => c.id === courseId);
  if (index >= 0) return OPTION_COLORS[(index + 5) % OPTION_COLORS.length];
  // Le CM, les TD et les TP d'une même matière (« 5.06 », « 5.06A ») partagent leur couleur.
  const name = title
    .replace(/^[a-z]?\d+(?:\.\d+)*[a-z]?\s+/i, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  // Le gris reste aux créneaux sans matière ni intitulé reconnaissable.
  return OPTION_COLORS[1 + (Math.abs(hash) % (OPTION_COLORS.length - 1))];
}

const fileName = (name: string) => name.replace(/\.(ics|ical|icalendar|ifb)$/i, "").trim() || "Calendrier";

/** Import d'un fichier .ics : résumé, nom du calendrier et nettoyage de l'ancien import. */
function ImportDialog({
  file,
  parsed,
  slots,
  calendars,
  onClose,
}: {
  file: string;
  parsed: IcalCalendar;
  slots: Slot[];
  calendars: CalendarInfo[];
  onClose: (imported: string | null) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [name, setName] = useState(fileName(file));
  const [busy, setBusy] = useState(false);
  const legacy = useMemo(() => {
    const keys = legacySlotKeys(parsed.events);
    return slots.filter((s) => keys.has(JSON.stringify([s.title, s.day, s.start, s.end, s.room])));
  }, [parsed, slots]);
  const [clean, setClean] = useState(true);
  useOverlay(() => onClose(null));
  const { events } = parsed;
  const timed = events.filter((e) => !e.allDay);
  const cancelled = timed.filter((e) => e.cancelled).length;
  // Période des cours, sans les vacances qui encadrent souvent l'année.
  const span = timed.length ? timed : events;
  const date = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" });
  const replaces = calendars.some((c) => c.calendar === name.trim());

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => onClose(null)}>
      <form
        role="dialog"
        aria-label={t("importIcal")}
        className="w-full max-w-md space-y-3 rounded-xl bg-pop p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!timed.length && !events.length) return;
          setBusy(true);
          const calendar = name.trim() || fileName(file);
          await importEvents(calendar, events, courses, clean ? legacy.map((s) => s.id) : []);
          onClose(calendar);
        }}
      >
        <p className="font-semibold">{t("importIcal")}</p>
        {events.length === 0 ? (
          <p className="text-sm text-muted">{t("icalEmpty")}</p>
        ) : (
          <>
            <p className="text-sm">
              {timed.length} {t(timed.length > 1 ? "icalClasses" : "icalClass")}{" "}
              {date.formatRange(new Date(span[0].start), new Date(Math.max(span[0].start, span[span.length - 1].end - 1)))}
              {cancelled > 0 && (
                <span className="text-muted">
                  {" "}
                  · {cancelled} {t(cancelled > 1 ? "icalCancelledMany" : "icalCancelledOne")}
                </span>
              )}
            </p>
            <label className="block text-xs text-muted">
              {t("calendarName")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${FIELD} mt-1 text-sm text-ink`}
              />
            </label>
            {replaces && <p className="text-xs text-muted">{t("icalReplaces")}</p>}
            {legacy.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={clean} onChange={(e) => setClean(e.target.checked)} />
                <span>
                  {t("icalCleanLegacy").replace("{n}", String(legacy.length))}
                </span>
              </label>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" className="h-8 rounded-md px-3 hover:bg-hover" onClick={() => onClose(null)}>
            {t("cancel")}
          </button>
          {events.length > 0 && (
            <button
              disabled={busy || !name.trim()}
              className="h-8 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95 disabled:opacity-40"
            >
              {t(replaces ? "icalUpdate" : "icalImport")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Détail d'une séance importée ; la matière choisie vaut pour toutes les séances du cours. */
function EventDialog({ event, onClose }: { event: CalEvent; onClose: (changed: boolean) => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  useOverlay(() => onClose(false));
  const day = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const when = event.all_day
    ? new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).formatRange(
        new Date(event.start),
        new Date(event.end - 1),
      )
    : `${day.format(new Date(event.start))}, ${clock(event.start)} – ${clock(event.end)}`;
  const rows: [string, string][] = [
    [t("type"), event.kind],
    [t("room"), event.room],
    [t("teacher"), event.teacher],
    [t("memo"), event.note],
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => onClose(false)}>
      <div
        role="dialog"
        aria-label={event.title}
        className="w-full max-w-sm space-y-3 rounded-xl bg-pop p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className={`font-semibold ${event.cancelled ? "line-through" : ""}`}>{event.title}</p>
          <p className="text-sm text-muted first-letter:uppercase">{when}</p>
          {event.cancelled ? <p className="mt-1 text-sm font-medium text-danger">{t("cancelledClass")}</p> : null}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          <dt className="text-muted">{t("calendar")}</dt>
          <dd>{event.calendar}</dd>
        </dl>
        {!event.all_day && (
          <label className="block text-xs text-muted">
            {t("course")}
            <select
              value={event.course_id ?? ""}
              onChange={async (e) => {
                await setEventsCourse(event.calendar, event.title, e.target.value || null);
                onClose(true);
              }}
              className={`${FIELD} mt-1 text-sm text-ink`}
            >
              <option value="">{t("noCourse")}</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || t("untitled")}
                </option>
              ))}
            </select>
            <span className="mt-1 block">{t("courseForAll")}</span>
          </label>
        )}
        <div className="flex justify-end">
          <button type="button" className="h-8 rounded-md px-3 hover:bg-hover" onClick={() => onClose(false)}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

type Item = {
  key: string;
  title: string;
  /** Minutes depuis minuit. */
  start: number;
  end: number;
  room: string;
  kind: string;
  color: string;
  cancelled: boolean;
  tip: string;
  open: () => void;
};

export function Timetable() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [week, setWeek] = useState(() => startOfWeek(Date.now()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [pending, setPending] = useState<{ file: string; parsed: IcalCalendar } | null>(null);
  const [now, setNow] = useState(Date.now());
  const icalInput = useRef<HTMLInputElement>(null);
  const weekEnd = addDays(week, 7);

  const reload = () => {
    void listSlots().then(setSlots);
    void listCalendars().then(setCalendars);
    void listEvents(week, weekEnd).then(setEvents);
  };
  useEffect(reload, [week]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const dayStarts = Array.from({ length: 7 }, (_, d) => addDays(week, d));
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);

  /** Séances et créneaux de la semaine type, jour par jour. */
  const byDay: Item[][] = dayStarts.map((dayStart, d) => {
    const next = addDays(dayStart, 1);
    const fromEvents = timed
      .filter((e) => e.start < next && e.end > dayStart)
      .map<Item>((e) => ({
        key: e.id,
        title: e.title,
        start: e.start <= dayStart ? 0 : minutesOf(e.start),
        end: e.end >= next ? 1440 : minutesOf(e.end),
        room: e.room,
        kind: e.kind,
        color: colorFor(courses, e.course_id, e.title),
        cancelled: !!e.cancelled,
        tip: [e.title, `${clock(e.start)} – ${clock(e.end)}`, e.room, e.teacher, e.note].filter(Boolean).join("\n"),
        open: () => setOpen(e),
      }));
    const fromSlots = slots
      .filter((s) => s.day === d)
      .map<Item>((s) => ({
        key: s.id,
        title: s.title,
        start: toMinutes(s.start),
        end: toMinutes(s.end),
        room: s.room,
        kind: "",
        color: s.course_id ? colorFor(courses, s.course_id, s.title) : "gray",
        cancelled: false,
        tip: [s.title, `${s.start} – ${s.end}`, s.room].filter(Boolean).join("\n"),
        open: () => setDraft(s),
      }));
    return [...fromEvents, ...fromSlots];
  });

  const all = byDay.flat();
  const days = byDay[6].length || allDay.some((e) => e.end > dayStarts[6]) ? 7 : 6;
  const first = Math.min(8, ...all.map((i) => Math.floor(i.start / 60)));
  const last = Math.max(19, ...all.map((i) => Math.ceil(i.end / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const todayIndex = dayStarts.findIndex((d) => d === todayStart);
  const names = dayNames(lang, "short");
  const range = new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric" }).formatRange(
    new Date(week),
    new Date(addDays(week, days - 1)),
  );
  const blank = (day: number, hour: number): Draft => ({
    course_id: null,
    title: "",
    day,
    start: `${pad(hour)}:00`,
    end: `${pad(Math.min(hour + 1, 23))}:${hour + 1 > 23 ? "59" : "00"}`,
    room: "",
  });
  const columns = `44px repeat(${days}, minmax(0, 1fr))`;

  return (
    <View
      title={t("timetable")}
      right={
        <>
          {calendars.length > 0 && (
            <Menu
              label={t("calendars")}
              align="right"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
              trigger={
                <>
                  <CalendarDays size={15} />
                  <span className="hidden sm:inline">{t("calendars")}</span>
                </>
              }
              items={calendars.flatMap((c) => [
                { note: `${c.calendar} · ${c.count} ${t(c.count > 1 ? "icalClasses" : "icalClass")}` },
                {
                  icon: <Trash2 size={15} />,
                  label: t("deleteCalendar"),
                  danger: true,
                  onClick: async () => {
                    if (!(await confirmDialog({ message: t("confirmDeleteCalendar").replace("{name}", c.calendar), confirmLabel: t("delete"), danger: true }))) return;
                    await deleteCalendar(c.calendar);
                    reload();
                  },
                },
              ])}
            />
          )}
          <button
            onClick={() => icalInput.current?.click()}
            aria-label={t("importIcal")}
            title={t("importIcal")}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
          >
            <CalendarPlus size={15} />
            <span className="hidden sm:inline">{t("importIcal")}</span>
          </button>
          <input
            ref={icalInput}
            type="file"
            accept=".ics,.ical,.ifb,.icalendar,text/calendar"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setPending({ file: file.name, parsed: parseIcal(await file.text()) });
            }}
          />
          <button
            onClick={() => setDraft(blank(todayIndex >= 0 && todayIndex < days ? todayIndex : 0, 8))}
            aria-label={t("addSlot")}
            title={t("addSlot")}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">{t("addSlot")}</span>
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setWeek(startOfWeek(Date.now()))}
          className="h-8 rounded-md px-3 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover"
        >
          {t("today")}
        </button>
        <span className="flex">
          <button
            aria-label={t("previousWeek")}
            title={t("previousWeek")}
            onClick={() => setWeek(addDays(week, -7))}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            aria-label={t("nextWeek")}
            title={t("nextWeek")}
            onClick={() => setWeek(addDays(week, 7))}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover"
          >
            <ChevronRight size={18} />
          </button>
        </span>
        <span className="font-medium first-letter:uppercase" aria-live="polite">
          {range}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid" style={{ gridTemplateColumns: columns }}>
            <span />
            {dayStarts.slice(0, days).map((dayStart, d) => (
              <span key={d} className="flex flex-col items-center pb-2 text-xs">
                <span className={`first-letter:uppercase ${d === todayIndex ? "text-accent-text" : "text-faint"}`}>
                  {names[d]}
                </span>
                <span
                  className={`mt-0.5 grid size-7 place-items-center rounded-full text-base ${
                    d === todayIndex ? "bg-accent font-semibold text-white" : "text-ink"
                  }`}
                >
                  {new Date(dayStart).getDate()}
                </span>
              </span>
            ))}
          </div>
          {allDay.length > 0 && (
            <div
              className="grid gap-y-0.5 pb-1 shadow-[inset_0_-1px_0_var(--color-line)]"
              style={{ gridTemplateColumns: columns }}
            >
              {allDay.map((e, i) => {
                const from = Math.max(0, Math.round((startOfDayOf(e.start) - week) / DAY));
                const to = Math.min(days, Math.round((startOfDayOf(e.end - 1) - week) / DAY) + 1);
                if (to <= from) return null;
                return (
                  <button
                    key={e.id}
                    onClick={() => setOpen(e)}
                    title={e.title}
                    style={{ gridColumn: `${from + 2} / ${to + 2}`, gridRow: i + 1 }}
                    className={`tag-${colorFor(courses, e.course_id, e.title)} mx-0.5 truncate rounded px-2 py-0.5 text-left text-xs font-medium hover:brightness-95`}
                  >
                    {e.title}
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid pt-2" style={{ gridTemplateColumns: columns }}>
            <div className="-mt-2">
              {hours.map((h) => (
                <div key={h} style={{ height: HOUR }} className="pr-2 text-right text-xs text-faint">
                  {pad(h)}:00
                </div>
              ))}
            </div>
            {byDay.slice(0, days).map((items, d) => (
              <div
                key={d}
                className={`relative shadow-[inset_1px_0_0_var(--color-line)] ${d === todayIndex ? "bg-hover/40" : ""}`}
                style={{
                  height: hours.length * HOUR,
                  backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px)",
                  backgroundSize: `100% ${HOUR}px`,
                }}
                onClick={(e) => {
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  setDraft(blank(d, first + Math.floor(y / HOUR)));
                }}
              >
                {layoutColumns(items).map((item) => {
                  const top = ((item.start - first * 60) / 60) * HOUR;
                  const height = Math.max(18, ((item.end - item.start) / 60) * HOUR);
                  return (
                    <button
                      key={item.key}
                      title={item.tip}
                      onClick={(e) => {
                        e.stopPropagation();
                        item.open();
                      }}
                      style={{
                        top: top + 1,
                        height: height - 2,
                        left: `calc(${(item.col / item.cols) * 100}% + 2px)`,
                        width: `calc(${100 / item.cols}% - 4px)`,
                      }}
                      className={`tag-${item.color} absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-xs leading-4 hover:z-10 hover:brightness-95 ${
                        item.cancelled ? "opacity-55" : ""
                      }`}
                    >
                      <span className={`block truncate font-semibold ${item.cancelled ? "line-through" : ""}`}>
                        {item.kind && <span className="font-normal opacity-75">{item.kind} · </span>}
                        {item.title}
                      </span>
                      <span className="block truncate opacity-75">
                        {pad(Math.floor(item.start / 60))}:{pad(item.start % 60)} – {pad(Math.floor(item.end / 60))}:
                        {pad(item.end % 60)}
                      </span>
                      {item.room && <span className="block truncate opacity-75">{item.room}</span>}
                    </button>
                  );
                })}
                {d === todayIndex && minutesOf(now) >= first * 60 && minutesOf(now) <= last * 60 && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-danger"
                    style={{ top: ((minutesOf(now) - first * 60) / 60) * HOUR }}
                  >
                    <span className="absolute -left-1 -top-1 size-2.5 rounded-full bg-danger" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {pending && (
        <ImportDialog
          file={pending.file}
          parsed={pending.parsed}
          slots={slots}
          calendars={calendars}
          onClose={async (calendar) => {
            setPending(null);
            if (!calendar) return;
            // Affiche la semaine de la prochaine séance (celle-ci, s'il y a cours cette semaine).
            const next = await nextEvent(startOfWeek(Date.now()), calendar);
            const target = next ? startOfWeek(next.start) : week;
            if (target === week) reload();
            else setWeek(target);
          }}
        />
      )}
      {open && (
        <EventDialog
          event={open}
          onClose={(changed) => {
            setOpen(null);
            if (changed) reload();
          }}
        />
      )}
      {draft && (
        <SlotDialog
          draft={draft}
          onClose={(changed) => {
            setDraft(null);
            if (changed) reload();
          }}
        />
      )}
    </View>
  );
}

const startOfDayOf = (at: number) => new Date(at).setHours(0, 0, 0, 0);
