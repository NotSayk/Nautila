import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { logStudySession } from "../data/stats";
import { useT } from "../i18n";
import { useStore } from "../store";

const DURATION = { focus: 25 * 60_000, break: 5 * 60_000 };

const KEY = "nautila.pomodoro";
/** Matière travaillée pendant les séances (réglage de l'appareil, "" : aucune). */
const COURSE_KEY = "nautila.pomodoro.course";
type Timer = ReturnType<typeof useStore.getState>["pomodoro"];

function readCourse(): string {
  try {
    return localStorage.getItem(COURSE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Fin d'une séance de travail terminée pendant que l'application était fermée, à journaliser au montage. */
function endedWhileClosed(raw: string | null, now: number): number | null {
  try {
    const s = JSON.parse(raw ?? "null") as Partial<Timer> | null;
    return s?.mode === "focus" && typeof s.endsAt === "number" && s.endsAt <= now ? s.endsAt : null;
  } catch {
    return null;
  }
}
let missed: number | null = null;

/** Minuteur relu depuis le stockage : une session déjà terminée passe à l'autre phase, à l'arrêt. */
function restore(raw: string | null, now: number): Timer | null {
  try {
    const s = JSON.parse(raw ?? "null") as Partial<Timer> | null;
    if (!s || (s.mode !== "focus" && s.mode !== "break") || typeof s.left !== "number") return null;
    const mode = s.mode;
    if (typeof s.endsAt === "number") {
      if (s.endsAt > now) return { mode, endsAt: s.endsAt, left: s.left };
      const next = mode === "focus" ? "break" : "focus";
      return { mode: next, endsAt: null, left: DURATION[next] };
    }
    return { mode, endsAt: null, left: Math.min(Math.max(s.left, 0), DURATION[mode]) };
  } catch {
    return null;
  }
}

// Le minuteur survit au rechargement : relu au chargement, enregistré à chaque changement.
try {
  const raw = localStorage.getItem(KEY);
  const saved = restore(raw, Date.now());
  missed = endedWhileClosed(raw, Date.now());
  if (saved) useStore.setState({ pomodoro: saved });
} catch {
  /* stockage indisponible : minuteur non restauré */
}
useStore.subscribe((state, prev) => {
  if (state.pomodoro === prev.pomodoro) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state.pomodoro));
  } catch {
    /* minuteur non mémorisé, sans gravité */
  }
});

function beep() {
  try {
    const ctx = new AudioContext();
    // Libère le contexte audio une fois le son terminé.
    const close = () => void ctx.close().catch(() => undefined);
    setTimeout(close, 1200);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch {
    /* pas de son disponible : le changement d'état reste visible */
  }
}

export function Pomodoro() {
  const t = useT();
  const { mode, endsAt, left } = useStore((s) => s.pomodoro);
  const pages = useStore((s) => s.pages);
  const courses = pages.filter((p) => p.kind === "course" && !p.deleted_at);
  const [course, setCourse] = useState(readCourse);
  // Une matière supprimée depuis ne compte plus : la séance part sans matière.
  const courseId = courses.some((c) => c.id === course) ? course : null;
  const [now, setNow] = useState(Date.now());
  const running = endsAt !== null;
  const remaining = running ? Math.max(0, endsAt - now) : left;

  const chooseCourse = (id: string) => {
    setCourse(id);
    try {
      localStorage.setItem(COURSE_KEY, id);
    } catch {
      /* choix non mémorisé, sans gravité */
    }
  };

  // Séance terminée application fermée : on la journalise au premier affichage.
  useEffect(() => {
    if (missed === null) return;
    const at = missed;
    missed = null;
    void logStudySession(at, readCourse() || null, DURATION.focus).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now()); // reprise : l'horloge affichée repart de l'instant présent
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  // Fin de session : on passe à l'autre phase, à l'arrêt.
  useEffect(() => {
    if (!running || remaining > 0) return;
    const next = mode === "focus" ? "break" : "focus";
    useStore.setState({ pomodoro: { mode: next, endsAt: null, left: DURATION[next] } });
    if (mode === "focus") void logStudySession(endsAt, courseId, DURATION.focus).catch(() => undefined);
    beep();
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(t("pomodoroDone"), { body: t(next === "break" ? "pomodoroBreak" : "pomodoroFocus") });
  }, [running, remaining, mode, t, endsAt, courseId]);

  const toggle = () =>
    useStore.setState({
      pomodoro: running ? { mode, endsAt: null, left: remaining } : { mode, endsAt: Date.now() + left, left },
    });
  const reset = () => useStore.setState({ pomodoro: { mode: "focus", endsAt: null, left: DURATION.focus } });

  const seconds = Math.ceil(remaining / 1000);
  const action = "grid size-6 place-items-center rounded text-muted hover:bg-active";
  return (
    <div className="flex h-[30px] items-center gap-2 rounded-md px-2 font-medium text-muted">
      <Timer size={18} strokeWidth={1.75} />
      {mode === "focus" && courses.length > 0 ? (
        <select
          value={courseId ?? ""}
          onChange={(e) => chooseCourse(e.target.value)}
          aria-label={t("pomodoroCourse")}
          title={t("pomodoroCourse")}
          className="min-w-0 flex-1 truncate rounded bg-transparent font-medium text-muted hover:bg-active"
        >
          <option value="">{t("pomodoroFocus")}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || t("untitled")}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex-1 truncate">{t(mode === "focus" ? "pomodoroFocus" : "pomodoroBreak")}</span>
      )}
      <span className={`tabular-nums ${running ? "text-ink" : ""}`}>
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </span>
      <button
        className={action}
        onClick={toggle}
        title={t(running ? "pauseTimer" : "start")}
        aria-label={t(running ? "pauseTimer" : "start")}
      >
        {running ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button className={action} onClick={reset} title={t("reset")} aria-label={t("reset")}>
        <RotateCcw size={13} />
      </button>
    </div>
  );
}
