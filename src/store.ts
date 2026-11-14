import { create } from "zustand";
import { cardStats } from "./data/cards";
import { createPage, listPages, type PageKind, type PageMeta } from "./data/pages";
import { translate, type Lang } from "./i18n";

export type Route =
  | { view: "home" }
  | { view: "review" }
  | { view: "tasks" }
  | { view: "trash" }
  | { view: "timetable" }
  | { view: "join"; id: string }
  | { view: "view"; id: string }
  | { view: "page"; id: string };

function parseHash(): Route {
  const [view, id] = location.hash.replace(/^#\/?/, "").split("/");
  if ((view === "page" || view === "join" || view === "view") && id) return { view, id };
  if (view === "review" || view === "tasks" || view === "trash" || view === "timetable")
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

const routeHash = (route: Route) =>
  route.view === "page" || route.view === "join" || route.view === "view"
    ? `/${route.view}/${route.id}`
    : route.view === "home"
      ? "/"
      : `/${route.view}`;

/** Onglets rouverts au lancement ; l'adresse courante l'emporte sur l'onglet actif mémorisé. */
function restoreTabs(): { tabs: Route[]; tab: number } {
  const current = parseHash();
  try {
    const saved = JSON.parse(stored("nautila.tabs") ?? "null") as { tabs: Route[]; tab: number } | null;
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      const tabs = saved.tabs.filter((r) => r && typeof r.view === "string");
      const tab = Math.min(Math.max(0, saved.tab | 0), tabs.length - 1);
      if (tabs.length === saved.tabs.length) {
        if (location.hash.replace(/^#\/?/, "")) tabs[tab] = current;
        return { tabs, tab };
      }
    }
  } catch {
    /* onglets illisibles : on repart d'un seul */
  }
  return { tabs: [current], tab: 0 };
}
const initial = restoreTabs();
/** Mémorise les onglets ; les écrans de passage (invitation, page publique) ne sont pas rouverts. */
const keepTabs = (tabs: Route[], tab: number) =>
  store(
    "nautila.tabs",
    JSON.stringify({ tabs: tabs.map((r) => (r.view === "join" || r.view === "view" ? { view: "home" } : r)), tab }),
  );

export type Theme = "system" | "light" | "dark";
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function initialTheme(): Theme {
  const saved = stored("nautila.theme");
  if (saved === "system" || saved === "light" || saved === "dark") return saved;
  // Ancien réglage clair/sombre : on le conserve tel quel.
  const old = stored("nautila.dark");
  return old ? (old === "1" ? "dark" : "light") : "system";
}
const firstTheme = initialTheme();

const isDesktop = () => matchMedia("(min-width: 768px)").matches;

type State = {
  route: Route;
  /** Onglets ouverts ; `route` est toujours celui de l'onglet actif. */
  tabs: Route[];
  tab: number;
  pages: PageMeta[];
  dueCount: number;
  lang: Lang;
  /** Choix de l'utilisateur ; `dark` en est le résultat effectif (le thème système change en direct). */
  theme: Theme;
  dark: boolean;
  searchOpen: boolean;
  /** Texte prérempli à l'ouverture de la recherche (ex. « #étiquette »). */
  searchSeed: string;
  /** Pages en cours de déplacement (boîte « Déplacer vers »). */
  moveIds: string[] | null;
  /** Incrémenté après chaque déplacement abouti (la barre latérale vide alors sa sélection). */
  moveCount: number;
  sidebarOpen: boolean;
  /** Minuteur Pomodoro : `endsAt` défini quand il tourne, `left` (ms) quand il est en pause. */
  sync: { status: "off" | "idle" | "syncing" | "error"; username?: string; error?: string; lastSync?: number };
  syncOpen: boolean;
  shortcutsOpen: boolean;
  /** Message bref en bas de l'écran, avec une action facultative (ex. « Annuler »). */
  toast: { message: string; action?: { label: string; run: () => void } } | null;
  pomodoro: { mode: "focus" | "break"; endsAt: number | null; left: number };
  navigate: (route: Route) => void;
  openTab: (route?: Route) => void;
  selectTab: (index: number) => void;
  closeTab: (index: number) => void;
  refreshPages: () => Promise<void>;
  refreshDue: () => Promise<void>;
  newPage: (input: { parentId?: string | null; kind?: PageKind }) => Promise<void>;
  setLang: (lang: Lang) => void;
  toggleDark: () => void;
  setTheme: (theme: Theme) => void;
  setSearchOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
};

export const useStore = create<State>((set, get) => ({
  route: initial.tabs[initial.tab],
  tabs: initial.tabs,
  tab: initial.tab,
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
  theme: firstTheme,
  dark: firstTheme === "system" ? systemDark() : firstTheme === "dark",
  searchOpen: false,
  searchSeed: "",
  moveIds: null,
  moveCount: 0,
  sync: { status: "off" },
  syncOpen: false,
  shortcutsOpen: false,
  toast: null,
  pomodoro: { mode: "focus", endsAt: null, left: 25 * 60_000 },
  sidebarOpen: isDesktop() && stored("nautila.sidebar") !== "0",

  navigate: (route) => {
    const tabs = get().tabs.map((r, i) => (i === get().tab ? route : r));
    // Sur mobile la barre latérale recouvre la page : on la referme.
    set({ route, tabs, searchOpen: false, ...(isDesktop() ? {} : { sidebarOpen: false }) });
    keepTabs(tabs, get().tab);
    location.hash = routeHash(route);
  },
  openTab: (route = { view: "home" }) => {
    const tabs = [...get().tabs];
    const tab = get().tab + 1;
    tabs.splice(tab, 0, route);
    set({ route, tabs, tab, searchOpen: false });
    keepTabs(tabs, tab);
    location.hash = routeHash(route);
  },
  selectTab: (index) => {
    const route = get().tabs[index];
    if (!route) return;
    set({ route, tab: index });
    keepTabs(get().tabs, index);
    location.hash = routeHash(route);
  },
  closeTab: (index) => {
    const { tabs, tab, lang } = get();
    if (tabs.length < 2 || !tabs[index]) return;
    const closed = tabs[index];
    const next = tabs.filter((_, i) => i !== index);
    const active = index < tab || tab === next.length ? tab - 1 : tab;
    // Fermer un onglet est réversible : on propose de le rouvrir plutôt que de demander confirmation.
    set({
      route: next[active],
      tabs: next,
      tab: active,
      toast: {
        message: translate(lang, "tabClosed"),
        action: {
          label: translate(lang, "undoAction"),
          run: () => {
            const now = [...get().tabs];
            now.splice(Math.min(index, now.length), 0, closed);
            const at = Math.min(index, now.length - 1);
            set({ route: closed, tabs: now, tab: at });
            keepTabs(now, at);
            location.hash = routeHash(closed);
          },
        },
      },
    });
    keepTabs(next, active);
    location.hash = routeHash(next[active]);
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
  toggleDark: () => get().setTheme(get().dark ? "light" : "dark"),
  setTheme: (theme) => {
    store("nautila.theme", theme);
    set({ theme, dark: theme === "system" ? systemDark() : theme === "dark" });
  },
  setSearchOpen: (searchOpen) => set({ searchOpen, searchSeed: "" }),
  setSidebarOpen: (sidebarOpen) => {
    if (isDesktop()) store("nautila.sidebar", sidebarOpen ? "1" : "0");
    set({ sidebarOpen });
  },
}));

// Précédent / suivant du navigateur, ou adresse saisie à la main : l'onglet actif suit.
window.addEventListener("hashchange", () => {
  const route = parseHash();
  const { tabs, tab, route: current } = useStore.getState();
  if (routeHash(route) === routeHash(current)) return;
  const next = tabs.map((r, i) => (i === tab ? route : r));
  useStore.setState({ route, tabs: next });
  keepTabs(next, tab);
});

// Thème « système » : suit le réglage du système d'exploitation en direct.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (useStore.getState().theme === "system") useStore.setState({ dark: systemDark() });
});

// Lancement sans adresse : l'onglet restauré s'écrit dans l'URL (sans entrée d'historique en plus),
// pour que le bouton Retour et l'adresse restent d'accord avec ce qui est affiché.
try {
  if (routeHash(useStore.getState().route) !== routeHash(parseHash()))
    history.replaceState(null, "", `#${routeHash(useStore.getState().route)}`);
} catch {
  /* adresse non modifiable (contexte restreint) */
}
