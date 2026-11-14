import { CalendarRange, Clock, Flame, Layers, PieChart, Target, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration, heatLevel, keyNoon, loadStudyStats, type HeatCell, type StudyStats } from "../../data/stats";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { PageIcon, SectionTitle } from "../common";

/** Couleurs de la carte de chaleur, du vide au plus intense, en clair puis en sombre. */
const HEAT = [
  "bg-[rgb(55_53_47/0.08)] dark:bg-[rgb(255_255_255/0.08)]",
  "bg-[#b6d4f0] dark:bg-[#1f3f63]",
  "bg-[#6ea8e0] dark:bg-[#2c66a3]",
  "bg-[#2f7fd0] dark:bg-[#4a91dc]",
  "bg-[#0b4f99] dark:bg-[#94c7f8]",
];
const TILE = "rounded-xl bg-panel px-4 py-3";
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

function Tile({ icon, value, label, sub }: { icon: React.ReactNode; value: string; label: string; sub?: string }) {
  return (
    <div className={TILE}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-[26px] font-bold leading-tight tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/**
 * Carte de chaleur des révisions : une ligne par jour de la semaine, une colonne par semaine.
 * Au clavier, une seule case est dans l'ordre de tabulation et les flèches déplacent le focus ;
 * la valeur de la case survolée ou focalisée s'affiche sous la carte.
 */
function Heatmap({ weeks }: { weeks: HeatCell[][] }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const max = Math.max(1, ...weeks.flat().map((c) => c.count));
  const last = weeks.length - 1;
  const todayRow = weeks[last].findIndex((c) => c.future) - 1;
  const [focus, setFocus] = useState<[number, number]>([last, todayRow < 0 ? 6 : todayRow]);
  const [shown, setShown] = useState<HeatCell | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const long = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const label = (c: HeatCell) => `${long.format(keyNoon(c.key))} : ${c.count} ${t("reviewsCount")}`;
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" });
  const month = new Intl.DateTimeFormat(lang, { month: "short" });

  const move = (e: React.KeyboardEvent) => {
    const [w, d] = focus;
    const next: [number, number] | null =
      e.key === "ArrowLeft"
        ? [Math.max(0, w - 1), d]
        : e.key === "ArrowRight"
          ? [Math.min(last, w + 1), d]
          : e.key === "ArrowUp"
            ? [w, Math.max(0, d - 1)]
            : e.key === "ArrowDown"
              ? [w, Math.min(6, d + 1)]
              : e.key === "Home"
                ? [0, d]
                : e.key === "End"
                  ? [last, d]
                  : null;
    if (!next) return;
    e.preventDefault();
    if (weeks[next[0]][next[1]].future) return;
    setFocus(next);
    setShown(weeks[next[0]][next[1]]);
    grid.current?.querySelector<HTMLElement>(`[data-cell="${next[0]}-${next[1]}"]`)?.focus();
  };

  return (
    <div className="mb-10">
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid grid-cols-[auto_1fr] gap-x-1.5 text-[10px] text-muted">
          <span />
          <div className="flex gap-[3px]" aria-hidden>
            {weeks.map((col, w) => {
              const first = col[0].key.slice(0, 7);
              const show = w === 0 || weeks[w - 1][0].key.slice(0, 7) !== first;
              return (
                <span key={w} className="w-[11px] overflow-visible whitespace-nowrap sm:w-[13px]">
                  {show ? month.format(keyNoon(col[0].key)) : ""}
                </span>
              );
            })}
          </div>
          <div className="flex flex-col gap-[3px]" aria-hidden>
            {weeks[0].map((c, d) => (
              <span key={d} className="h-[11px] leading-[11px] sm:h-[13px] sm:leading-[13px]">
                {d % 2 === 0 ? weekday.format(keyNoon(c.key)) : ""}
              </span>
            ))}
          </div>
          <div
            ref={grid}
            role="grid"
            aria-label={t("statsHeatmap")}
            onKeyDown={move}
            onMouseLeave={() => setShown(null)}
            className="flex flex-col gap-[3px]"
          >
            {weeks[0].map((_, d) => (
              <div role="row" key={d} className="flex gap-[3px]">
                {weeks.map((col, w) => {
                  const c = col[d];
                  if (c.future) return <span key={w} role="presentation" className="size-[11px] sm:size-[13px]" />;
                  return (
                    <span
                      key={w}
                      role="gridcell"
                      data-cell={`${w}-${d}`}
                      tabIndex={focus[0] === w && focus[1] === d ? 0 : -1}
                      aria-label={label(c)}
                      title={label(c)}
                      onFocus={() => {
                        setFocus([w, d]);
                        setShown(c);
                      }}
                      onMouseEnter={() => setShown(c)}
                      className={`size-[11px] rounded-[2px] sm:size-[13px] ${HEAT[heatLevel(c.count, max)]}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <p aria-live="polite" className="min-h-4">
          {shown ? label(shown) : t("statsHeatmapHint")}
        </p>
        <span className="flex items-center gap-1" aria-hidden>
          {t("heatLess")}
          {HEAT.map((c, i) => (
            <span key={i} className={`size-[11px] rounded-[2px] ${c}`} />
          ))}
          {t("heatMore")}
        </span>
      </div>
    </div>
  );
}

function Forecast({ days }: { days: StudyStats["forecast"] }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const max = Math.max(1, ...days.map((d) => d.count));
  const short = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric" });
  const long = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" });
  return (
    <ol className="mb-10 grid h-40 grid-cols-14 items-end gap-1 rounded-xl bg-panel p-3" aria-label={t("statsForecast")}>
      {days.map((d, i) => (
        <li
          key={d.key}
          aria-label={`${i === 0 ? t("today") : long.format(keyNoon(d.key))} : ${d.count} ${t("cardsCount")}`}
          title={`${long.format(keyNoon(d.key))} : ${d.count}`}
          className="flex h-full min-w-0 flex-col items-center justify-end gap-1"
        >
          <span className="text-[10px] tabular-nums text-muted" aria-hidden>
            {d.count || ""}
          </span>
          <span
            aria-hidden
            className={`w-full max-w-6 rounded-t-[3px] ${d.count ? "bg-accent" : "bg-line"}`}
            style={{ height: `${d.count ? Math.max(4, (d.count / max) * 80) : 2}%` }}
          />
          <span className="w-full truncate text-center text-[10px] text-muted" aria-hidden>
            {i === 0 ? (
              t("todayShort")
            ) : (
              <>
                {/* Sur un téléphone, la colonne est trop étroite pour le jour de la semaine : le quantième suffit. */}
                <span className="sm:hidden">{new Date(keyNoon(d.key)).getDate()}</span>
                <span className="max-sm:hidden">{short.format(keyNoon(d.key))}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Buckets({ buckets }: { buckets: StudyStats["buckets"] }) {
  const t = useT();
  const total = buckets.fresh + buckets.learning + buckets.mature;
  const parts: [number, string, string][] = [
    [buckets.fresh, t("statsNew"), "bg-[#b6d4f0] dark:bg-[#2c66a3]"],
    [buckets.learning, t("statsLearning"), "bg-[#f5c26b] dark:bg-[#b07a1f]"],
    [buckets.mature, t("statsMature"), "bg-[#448361] dark:bg-[#5fae83]"],
  ];
  return (
    <div className="mb-10 rounded-xl bg-panel p-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-line" aria-hidden>
        {total > 0 && parts.map(([n, , color], i) => <span key={i} className={color} style={{ width: `${(n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {parts.map(([n, label, color]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${color}`} aria-hidden />
            <span className="text-muted">{label}</span>
            <span className="font-medium tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudyTime({ stats }: { stats: StudyStats }) {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [range, setRange] = useState<7 | 30>(7);
  const rows = range === 7 ? stats.time7 : stats.time30;
  const max = Math.max(1, ...rows.map((r) => r.duration));
  const total = rows.reduce((s, r) => s + r.duration, 0);
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle>
          <Clock size={14} />
          {t("statsStudyTime")}
        </SectionTitle>
        <div role="group" aria-label={t("statsRange")} className="mb-2 flex rounded-md bg-hover p-0.5 text-xs">
          {([7, 30] as const).map((n) => (
            <button
              key={n}
              aria-pressed={range === n}
              onClick={() => setRange(n)}
              className={`h-6 rounded px-2 ${range === n ? "bg-pop font-medium shadow-[0_0_0_1px_var(--color-line)]" : "text-muted"}`}
            >
              {n} {t("daysShort")}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-10 rounded-xl bg-panel p-3">
        {rows.length === 0 ? (
          <p className="px-1 py-3 text-center text-muted">{t("statsNoStudyTime")}</p>
        ) : (
          <>
            <p className="mb-2 px-1 text-muted">
              {t("total")} : <span className="font-medium text-ink tabular-nums">{formatDuration(total)}</span>
            </p>
            {rows.map((r) => {
              const page = pages.find((p) => p.id === r.course_id);
              return (
                <div key={r.course_id ?? "none"} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 px-1 py-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {page && <PageIcon page={page} size={14} />}
                    <span className="truncate">{page ? page.title || t("untitled") : t("noCourse")}</span>
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.duration / max) * 100}%` }} />
                  </span>
                  <span className="tabular-nums text-muted">{formatDuration(r.duration)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

/** Section « Statistiques » des révisions. */
export function StatsView() {
  const t = useT();
  const pages = useStore((s) => s.pages);
  const [stats, setStats] = useState<StudyStats | null>(null);
  useEffect(() => void loadStudyStats().then(setStats), []);
  if (!stats)
    return (
      <p role="status" className="text-muted">
        {t("loading")}
      </p>
    );
  return (
    <>
      <h1 className="mb-6 text-[30px] font-bold leading-tight">{t("statsTitle")}</h1>
      <div className="mb-8 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          icon={<Flame size={14} />}
          label={t("streak")}
          value={`${stats.streak.current} ${t(stats.streak.current > 1 ? "daysLong" : "dayLong")}`}
          sub={`${t("streakBest")} : ${stats.streak.best}`}
        />
        <Tile icon={<Target size={14} />} label={t("reviewedToday")} value={String(stats.today)} />
        <Tile icon={<CalendarRange size={14} />} label={t("reviewedWeek")} value={String(stats.week)} />
        <Tile icon={<TrendingUp size={14} />} label={t("successRate")} value={pct(stats.success)} />
      </div>

      <SectionTitle>
        <CalendarRange size={14} />
        {t("statsHeatmap")}
      </SectionTitle>
      <Heatmap weeks={stats.heat} />

      <SectionTitle>
        <TrendingUp size={14} />
        {t("statsForecast")}
      </SectionTitle>
      <Forecast days={stats.forecast} />

      <SectionTitle>
        <PieChart size={14} />
        {t("statsBuckets")}
      </SectionTitle>
      <Buckets buckets={stats.buckets} />

      <StudyTime stats={stats} />

      <SectionTitle>
        <Layers size={14} />
        {t("statsByDeck")}
      </SectionTitle>
      {stats.decks.length === 0 ? (
        <p className="text-muted">{t("statsNoReviews")}</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="h-8 text-left text-xs text-muted shadow-[inset_0_-1px_0_var(--color-line)]">
              <th className="font-normal">{t("deck")}</th>
              <th className="w-28 text-right font-normal">{t("reviewsCountTitle")}</th>
              <th className="w-28 text-right font-normal">{t("successRate")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.decks.map((d) => {
              const page = pages.find((p) => p.id === d.page_id);
              return (
                <tr key={d.page_id} className="h-10 shadow-[inset_0_-1px_0_var(--color-line)]">
                  <td className="max-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      {page && <PageIcon page={page} />}
                      <span className="truncate font-medium">{page ? page.title || t("untitled") : t("deletedDeck")}</span>
                    </span>
                  </td>
                  <td className="text-right tabular-nums text-muted">{d.reviews}</td>
                  <td className="text-right tabular-nums">{pct(d.success)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
