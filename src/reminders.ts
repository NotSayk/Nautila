import { listTasks } from "./data/tasks";
import { translate } from "./i18n";
import { useStore } from "./store";

const KEY = "nautila.reminded";
const DAY = 86_400_000;

export async function enableReminders(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const granted = (await Notification.requestPermission()) === "granted";
  if (granted) void notifyDueTasks();
  return granted;
}

/** Prévient une fois par jour des échéances d'aujourd'hui et de demain. */
export async function notifyDueTasks() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = new Date().toDateString();
  let seen: string[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (stored.day === today) seen = stored.ids;
  } catch {
    /* mémo illisible : on repart de zéro */
  }
  const lang = useStore.getState().lang;
  const limit = new Date().setHours(0, 0, 0, 0) + 2 * DAY;
  for (const task of await listTasks()) {
    if (task.done || task.due_at === null || task.due_at >= limit || seen.includes(task.id)) continue;
    const when = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(task.due_at);
    new Notification(task.title, { body: `${translate(lang, "dueSoon")} ${when}` });
    seen.push(task.id);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today, ids: seen }));
  } catch {
    /* sans mémo, le rappel pourra se répéter */
  }
}
