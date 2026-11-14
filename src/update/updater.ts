import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { isTauri } from "../db";
import { translate, type Key } from "../i18n";
import { useStore } from "../store";
import { CHECK_INTERVAL, FIRST_CHECK_DELAY, RELEASES_URL } from "./logic";

type Phase = "idle" | "available" | "downloading" | "ready";

type UpdateState = {
  /** Version installée (connue seulement dans l'app de bureau). */
  current: string | null;
  /** Vrai si l'installation peut se remplacer toute seule (faux pour un .deb ou un .rpm). */
  selfUpdate: boolean;
  phase: Phase;
  /** Version proposée et notes de version. */
  found: { version: string; notes: string } | null;
  /** Version écartée par « Plus tard » : plus proposée avant le prochain lancement. */
  dismissed: string | null;
  downloaded: number;
  total: number | null;
  /** Le dernier téléchargement a échoué : la carte l'explique et renvoie à la page des versions. */
  installFailed: boolean;
  checking: boolean;
};

export const useUpdate = create<UpdateState>(() => ({
  current: null,
  selfUpdate: false,
  phase: "idle",
  found: null,
  dismissed: null,
  downloaded: 0,
  total: null,
  installFailed: false,
  checking: false,
}));

const set = useUpdate.setState;
const get = useUpdate.getState;

/** Mise à jour trouvée par la dernière vérification (objet du greffon, non sérialisable). */
let pending: Update | null = null;

function toast(key: Key, extra?: { version?: string; releases?: boolean }) {
  const lang = useStore.getState().lang;
  const message = translate(lang, key).replace("{version}", extra?.version ?? "");
  const action = extra?.releases
    ? { label: translate(lang, "updateReleasesPage"), run: () => void openReleases() }
    : undefined;
  useStore.setState({ toast: { message, action } });
}

/** Ouvre la page des versions dans le navigateur (le droit d'ouverture se limite à cette adresse). */
export async function openReleases() {
  try {
    if (isTauri()) await (await import("@tauri-apps/plugin-opener")).openUrl(RELEASES_URL);
    else window.open(RELEASES_URL, "_blank", "noopener,noreferrer");
  } catch {
    /* rien de plus à faire : le lien reste affiché dans l'interface */
  }
}

/** Lit la version installée et la capacité de mise à jour intégrée. */
async function loadInfo() {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const { invoke } = await import("@tauri-apps/api/core");
    const [current, selfUpdate] = await Promise.all([getVersion(), invoke<boolean>("self_update_supported")]);
    set({ current, selfUpdate });
  } catch {
    set({ selfUpdate: false });
  }
}

/** Cherche une mise à jour. Silencieux si `manual` est faux ; sinon dit toujours ce qui s'est passé. */
export async function checkForUpdates(manual = false) {
  const { phase, checking } = get();
  if (!isTauri() || checking || phase === "downloading" || phase === "ready") return;
  set({ checking: true });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 30_000 });
    if (!update) {
      if (manual) toast("updateUpToDate");
      return;
    }
    await pending?.close().catch(() => {});
    pending = update;
    set({ phase: "available", found: { version: update.version, notes: update.body ?? "" }, installFailed: false });
    if (manual) {
      set({ dismissed: null });
      toast("updateAvailable", { version: update.version });
    }
  } catch {
    if (manual) toast("updateCheckFailed", { releases: true });
  } finally {
    set({ checking: false });
  }
}

/** « Plus tard » : n'afficher de nouveau cette version qu'au prochain lancement. */
export function dismissUpdate() {
  set({ dismissed: get().found?.version ?? null });
}

/** Télécharge, vérifie la signature et installe la mise à jour trouvée. */
export async function installUpdate() {
  const update = pending;
  if (!update || get().phase !== "available") return;
  set({ phase: "downloading", downloaded: 0, total: null, installFailed: false });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") set({ total: event.data.contentLength ?? null });
      else if (event.event === "Progress") set({ downloaded: get().downloaded + event.data.chunkLength });
    });
    set({ phase: "ready" });
  } catch {
    set({ phase: "available", installFailed: true });
  }
}

export async function restartApp() {
  try {
    await (await import("@tauri-apps/plugin-process")).relaunch();
  } catch {
    toast("updateRestartFailed");
  }
}

/** Lance les vérifications automatiques (bureau seulement) ; renvoie la fonction qui les arrête. */
export function startUpdateChecks() {
  if (!isTauri()) return () => {};
  void loadInfo();
  const first = setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY);
  const every = setInterval(() => void checkForUpdates(), CHECK_INTERVAL);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
