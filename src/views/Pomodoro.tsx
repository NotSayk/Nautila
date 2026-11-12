import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";

const DURATION = { focus: 25 * 60_000, break: 5 * 60_000 };

function beep() {
  try {
    const ctx = new AudioContext();
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
  const [now, setNow] = useState(Date.now());
  const running = endsAt !== null;
  const remaining = running ? Math.max(0, endsAt - now) : left;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  // Fin de session : on passe à l'autre phase, à l'arrêt.
  useEffect(() => {
    if (!running || remaining > 0) return;
    const next = mode === "focus" ? "break" : "focus";
    useStore.setState({ pomodoro: { mode: next, endsAt: null, left: DURATION[next] } });
    beep();
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(t("pomodoroDone"), { body: t(next === "break" ? "pomodoroBreak" : "pomodoroFocus") });
  }, [running, remaining, mode, t]);

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
      <span className="flex-1 truncate">{t(mode === "focus" ? "pomodoroFocus" : "pomodoroBreak")}</span>
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
