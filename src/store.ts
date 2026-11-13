import { create } from "zustand";
import { cardStats } from "./data/cards";
import { createPage, listPages, type PageKind, type PageMeta } from "./data/pages";
import type { Lang } from "./i18n";

export type Route =
  | { view: "home" }
  | { view: "review" }
  | { view: "tasks" }
  | { view: "trash" }
  | { view: "timetable" }
  | { view: "grades" }
  | { view: "join"; id: string }
  | { view: "view"; id: string }
  | { view: "page"; id: string };

function parseHash(): Route {
  const [view, id] = location.hash.replace(/^#\/?/, "").split("/");
  if ((view === "page" || view === "join" || view === "view") && id) return { view, id };
  if (view === "review" || view === "tasks" || view === "trash" || view === "timetable" || view === "grades")
    return { view };
  return { view: "home" };
}

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* préférence non mémorisée, sans gravité */
  }
};

const isDesktop = () => matchMedia("(min-width: 768px)").matches;

type State = {
  route: Route;
  pages: PageMeta[];
  dueCount: number;
  lang: Lang;
  dark: boolean;
  searchOpen: boolean;
  /** Texte prérempli à l'ouverture de la recherche (ex. « #étiquette »). */
  searchSeed: string;
  /** Pages en cours de déplacement (boîte « Déplacer vers »). */
  moveIds: string[] | null;
  sidebarOpen: boolean;
  /** Minuteur Pomodoro : `endsAt` défini quand il tourne, `left` (ms) quand il est en pause. */
  sync: { status: "off" | "idle" | "syncing" | "error"; username?: string; error?: string; lastSync?: number };
  syncOpen: boolean;
  shortcutsOpen: boolean;
  /** Message bref en bas de l'écran, avec une action facultative (ex. « Annuler »). */
  toast: { message: string; action?: { label: string; run: () => void } } | null;
  pomodoro: { mode: "focus" | "break"; endsAt: number | null; left: number };
  navigate: (route: Route) => void;
  refreshPages: () => Promise<void>;
  refreshDue: () => Promise<void>;
  newPage: (input: { parentId?: string | null; kind?: PageKind }) => Promise<void>;
  setLang: (lang: Lang) => void;
  toggleDark: () => void;
  setSearchOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
};

export const useStore = create<State>((set, get) => ({
  route: parseHash(),
  pages: [],
  dueCount: 0,
  lang:
    stored("nautila.lang") === "en"
      ? "en"
      : stored("nautila.lang") === "fr"
        ? "fr"
        : navigator.language.startsWith("fr")
          ? "fr"
          : "en",
  dark: stored("nautila.dark") ? stored("nautila.dark") === "1" : matchMedia("(prefers-color-scheme: dark)").matches,
  searchOpen: false,
  searchSeed: "",
  moveIds: null,
  sync: { status: "off" },
  syncOpen: false,
  shortcutsOpen: false,
  toast: null,
  pomodoro: { mode: "focus", endsAt: null, left: 25 * 60_000 },
  sidebarOpen: isDesktop() && stored("nautila.sidebar") !== "0",

  navigate: (route) => {
    location.hash =
      route.view === "page" || route.view === "join" || route.view === "view"
        ? `/${route.view}/${route.id}`
        : route.view === "home"
          ? "/"
          : `/${route.view}`;
    // Sur mobile la barre latérale recouvre la page : on la referme.
    set({ route, searchOpen: false, ...(isDesktop() ? {} : { sidebarOpen: false }) });
  },
  refreshPages: async () => set({ pages: await listPages() }),
  refreshDue: async () => set({ dueCount: (await cardStats()).due }),
  newPage: async ({ parentId, kind }) => {
    const page = await createPage({ parentId, kind });
    await get().refreshPages();
    get().navigate({ view: "page", id: page.id });
  },
  setLang: (lang) => {
    store("nautila.lang", lang);
    set({ lang });
  },
  toggleDark: () => {
    const dark = !get().dark;
    store("nautila.dark", dark ? "1" : "0");
    set({ dark });
  },
  setSearchOpen: (searchOpen) => set({ searchOpen, searchSeed: "" }),
  setSidebarOpen: (sidebarOpen) => {
    if (isDesktop()) store("nautila.sidebar", sidebarOpen ? "1" : "0");
    set({ sidebarOpen });
  },
}));

window.addEventListener("hashchange", () => useStore.setState({ route: parseHash() }));
