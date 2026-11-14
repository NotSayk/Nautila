import { listTasks } from "./data/tasks";

const KEY = "nautila.reminded";
const DAY = 86_400_000;
/** Tant que l'application reste ouverte, les échéances sont revérifiées à cet intervalle. */
const CHECK_EVERY = 15 * 60_000;

export async function enableReminders(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  const granted = (await Notification.requestPermission()) === "granted";
  if (granted) void notifyDueTasks();
  return granted;
}

/** Identifiants déjà signalés aujourd'hui, lus dans le mémo ; toute forme inattendue donne une liste vide. */
export function readReminded(raw: string | null, today: string): string[] {
  try {
    const stored: unknown = JSON.parse(raw ?? "null");
    if (typeof stored !== "object" || stored === null) return [];
    const { day, ids } = stored as { day?: unknown; ids?: unknown };
    if (day !== today || !Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string");
  } catch {
    return []; // mémo illisible : on repart de zéro
  }
}

/** Tâches à signaler : non faites, avec une échéance aujourd'hui ou demain (ou dépassée), pas encore signalées. */
export function dueSoon<T extends { id: string; done: number | boolean; due_at: number | null }>(
  tasks: T[],
  seen: string[],
  now = Date.now(),
): T[] {
  const limit = new Date(now).setHours(0, 0, 0, 0) + 2 * DAY;
  return tasks.filter((t) => !t.done && t.due_at !== null && t.due_at < limit && !seen.includes(t.id));
}

let checking: Promise<void> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Prévient une fois par jour de chaque échéance d'aujourd'hui et de demain. À l'ouverture, puis
 * toutes les quinze minutes tant que l'application reste ouverte (une échéance qui entre dans la
 * fenêtre en cours de journée est donc signalée aussi).
 */
export function notifyDueTasks(): Promise<void> {
  timer ??= setInterval(() => void notifyDueTasks().catch(() => undefined), CHECK_EVERY);
  // Deux vérifications simultanées signaleraient deux fois la même échéance.
  checking ??= check().finally(() => (checking = undefined));
  return checking;
}

async function check() {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
  const today = new Date().toDateString();
  const read = () => {
    try {
      return readReminded(localStorage.getItem(KEY), today);
    } catch {
      return [];
    }
  };
  // L'interface est chargée à la demande : les fonctions pures de ce fichier se testent sans elle.
  const [{ translate }, { useStore }] = await Promise.all([import("./i18n"), import("./store")]);
  const lang = useStore.getState().lang;
  // Le mémo est relu avant chaque envoi : un autre onglet a pu signaler la tâche entre-temps.
  for (const task of dueSoon(await listTasks(), read())) {
    const seen = read();
    if (seen.includes(task.id)) continue;
    // Noté avant l'envoi : s'il échoue, mieux vaut un rappel de moins qu'un rappel à chaque vérification.
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: today, ids: [...seen, task.id] }));
    } catch {
      /* sans mémo, le rappel pourra se répéter */
    }
    const when = new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(task.due_at!);
    try {
      new Notification(task.title, { body: `${translate(lang, "dueSoon")} ${when}` });
    } catch {
      /* notification refusée par le système */
    }
  }
}
