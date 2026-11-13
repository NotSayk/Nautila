import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteSlot, listSlots, saveSlot, toMinutes, type Slot } from "../data/school";
import { OPTION_COLORS } from "../data/dbquery";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay, View } from "./common";

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

export function Timetable() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const courses = useStore((s) => s.pages).filter((p) => p.kind === "course");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const reload = () => listSlots().then(setSlots);
  useEffect(() => void reload(), []);

  const days = slots.some((s) => s.day === 6) ? 7 : 6;
  const first = Math.min(8, ...slots.map((s) => Math.floor(toMinutes(s.start) / 60)));
  const last = Math.max(19, ...slots.map((s) => Math.ceil(toMinutes(s.end) / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const today = (new Date().getDay() + 6) % 7;
  const names = dayNames(lang, "short");
  const blank = (day: number, hour: number): Draft => ({
    course_id: null,
    title: "",
    day,
    start: `${pad(hour)}:00`,
    end: `${pad(hour + 1)}:00`,
    room: "",
  });

  return (
    <View
      title={t("timetable")}
      right={
        <button
          onClick={() => setDraft(blank(today < days ? today : 0, 8))}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-muted hover:bg-hover"
        >
          <Plus size={15} />
          {t("addSlot")}
        </button>
      }
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `44px repeat(${days}, minmax(0, 1fr))` }}>
          <span />
          {names.slice(0, days).map((name, d) => (
            <span
              key={d}
              className={`pb-2 text-center text-xs first-letter:uppercase ${d === today ? "font-semibold text-ink" : "text-faint"}`}
            >
              {name}
            </span>
          ))}
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR }} className="-mt-2 pr-2 text-right text-xs text-faint">
                {pad(h)}:00
              </div>
            ))}
          </div>
          {Array.from({ length: days }, (_, d) => (
            <div
              key={d}
              className="relative shadow-[inset_1px_0_0_var(--color-line)]"
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
              {slots
                .filter((s) => s.day === d)
                .map((s) => {
                  const index = courses.findIndex((c) => c.id === s.course_id);
                  const color = index < 0 ? "gray" : OPTION_COLORS[(index + 5) % OPTION_COLORS.length];
                  const top = ((toMinutes(s.start) - first * 60) / 60) * HOUR;
                  const height = ((toMinutes(s.end) - toMinutes(s.start)) / 60) * HOUR;
                  return (
                    <button
                      key={s.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft(s);
                      }}
                      style={{ top: top + 1, height: height - 2 }}
                      className={`tag-${color} absolute inset-x-1 overflow-hidden rounded-md px-2 py-1 text-left text-xs leading-4 hover:brightness-95`}
                    >
                      <span className="block truncate font-semibold">{s.title}</span>
                      <span className="block truncate opacity-75">
                        {s.start} – {s.end}
                        {s.room && ` · ${s.room}`}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {draft && (
        <SlotDialog
          draft={draft}
          onClose={(changed) => {
            setDraft(null);
            if (changed) void reload();
          }}
        />
      )}
    </View>
  );
}
