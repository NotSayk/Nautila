import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { initDb, isTauri } from "./db";
import { useT } from "./i18n";
import { useStore } from "./store";
import { Dashboard } from "./views/Dashboard";
import { Timetable } from "./views/Timetable";
import { notifyDueTasks } from "./reminders";
import { purgeOldTrash } from "./data/trash";
import { startSync } from "./sync/engine";
import { JoinView, PublicView } from "./views/ShareDialog";
import { ConfirmHost } from "./views/dialogs";
import { ShortcutsDialog, Toast, useGlobalShortcuts } from "./views/Overlays";
import { SyncDialog } from "./views/SyncDialog";
import { MoveDialog } from "./views/MoveDialog";
import { PageView } from "./views/PageView";
import { Review } from "./views/Review";
import { SearchDialog } from "./views/SearchDialog";
import { Sidebar } from "./views/Sidebar";
import { Tabs } from "./views/Tabs";
import { Tasks } from "./views/Tasks";
import { Trash } from "./views/Trash";

type Status =
  | { state: "loading" }
  | { state: "ready"; persistent: boolean; blocked: boolean }
  | { state: "error"; message: string };

// Une seule ouverture de la base, même si React monte le composant deux fois.
let opening: ReturnType<typeof initDb> | undefined;

const CLOUD_HINT = "nautila.cloudHint";

/**
 * Version navigateur servie par un serveur Nautila, sans compte connecté : les notes ne
 * vivent que dans ce navigateur. Un bandeau propose de se connecter pour les mettre dans le cloud.
 */
function CloudHint() {
  const t = useT();
  const off = useStore((s) => s.sync.status === "off");
  const [server, setServer] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(CLOUD_HINT) === "hidden";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (isTauri() || !off || hidden) return;
    let live = true;
    fetch(`${location.origin}/api/health`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => live && setServer(body?.ok === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [off, hidden]);
  if (!server || !off || hidden) return null;
  return (
    <div className="flex items-center gap-3 bg-panel px-4 py-2 shadow-[inset_0_-1px_0_var(--color-line)]">
      <p className="min-w-0 flex-1 text-muted">{t("cloudHint")}</p>
      <button
        className="h-7 shrink-0 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95"
        onClick={() => useStore.setState({ syncOpen: true })}
      >
        {t("signIn")}
      </button>
      <button
        aria-label={t("close")}
        title={t("close")}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(CLOUD_HINT, "hidden");
          } catch {
            /* le bandeau reviendra au prochain lancement */
          }
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** Écran de démarrage : discret, et sans scintillement si la base s'ouvre vite. */
function Splash() {
  const t = useT();
  return (
    <div role="status" aria-label={t("loading")} className="grid h-full place-items-center">
      <div className="flex animate-[splash_0.4s_0.25s_both_ease-out] flex-col items-center gap-3">
        <img src="/icon.svg" alt="" className="size-12 rounded-xl" />
        <span className="text-base font-semibold tracking-wide text-muted">Nautila</span>
      </div>
    </div>
  );
}

/**
 * Bandeau du haut : un autre onglet tient la base (message non fermable, il faut agir) ou le
 * stockage n'est pas durable (fermable pour la session).
 */
function StorageBanner({ persistent, blocked }: { persistent: boolean; blocked: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("nautila.persistHint") === "hidden";
    } catch {
      return false;
    }
  });
  if (persistent && !blocked) return null;
  if (!blocked && hidden) return null;
  return (
    <div role="alert" className="flex items-center gap-3 bg-[#fbf3db] px-4 py-2 text-[#402c1b] dark:bg-[#564328] dark:text-white/85">
      <p className="min-w-0 flex-1">{blocked ? t("blockedByOtherTab") : t("notPersistent")}</p>
      {blocked ? (
        <button
          className="h-7 shrink-0 rounded-md bg-accent px-3 font-medium text-white hover:brightness-95"
          onClick={() => location.reload()}
        >
          {t("reload")}
        </button>
      ) : (
        <button
          aria-label={t("close")}
          title={t("close")}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"
          onClick={() => {
            setHidden(true);
            try {
              sessionStorage.setItem("nautila.persistHint", "hidden");
            } catch {
              /* le bandeau reviendra au prochain lancement */
            }
          }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function App() {
  const t = useT();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const route = useStore((s) => s.route);
  const tab = useStore((s) => s.tab);
  const dark = useStore((s) => s.dark);
  const lang = useStore((s) => s.lang);
  const searchOpen = useStore((s) => s.searchOpen);
  const moveIds = useStore((s) => s.moveIds);
  const syncOpen = useStore((s) => s.syncOpen);
  const shortcutsOpen = useStore((s) => s.shortcutsOpen);

  const load = useCallback((retry = false) => {
    if (retry) {
      opening = undefined;
      setStatus({ state: "loading" });
    }
    (opening ??= initDb()).then(
      async (db) => {
        // Pages supprimées depuis plus de 30 jours : retirées de la corbeille avant le premier affichage.
        await purgeOldTrash().catch(() => 0);
        await Promise.all([useStore.getState().refreshPages(), useStore.getState().refreshDue()]);
        setStatus({ state: "ready", persistent: db.persistent, blocked: !!db.blockedByOtherTab });
        void notifyDueTasks();
        void startSync();
      },
      (err) => setStatus({ state: "error", message: String(err?.message ?? err) }),
    );
  }, []);
  useEffect(() => load(), [load]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.lang = lang;
  }, [dark, lang]);

  useGlobalShortcuts();

  if (status.state === "loading") return <Splash />;
  if (status.state === "error")
    return (
      <div role="alert" className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md">
          <p className="font-medium">{t("loadError")}</p>
          <p className="mt-2 break-words text-muted">{status.message}</p>
          <button
            className="mt-4 h-8 rounded-md bg-accent px-4 font-medium text-white hover:brightness-95"
            onClick={() => load(true)}
          >
            {t("loadRetry")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex h-full">
      {route.view !== "view" && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        {route.view !== "view" && <Tabs />}
        {route.view !== "view" && <CloudHint />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <StorageBanner persistent={status.persistent} blocked={status.blocked} />
          {route.view === "home" && <Dashboard />}
          {route.view === "page" && <PageView key={`${tab}:${route.id}`} id={route.id} />}
          {route.view === "review" && <Review />}
          {route.view === "tasks" && <Tasks />}
          {route.view === "trash" && <Trash />}
          {route.view === "timetable" && <Timetable />}
          {route.view === "join" && <JoinView id={route.id} />}
          {route.view === "view" && <PublicView id={route.id} />}
        </main>
      </div>
      {searchOpen && <SearchDialog />}
      {moveIds && <MoveDialog ids={moveIds} />}
      {syncOpen && <SyncDialog />}
      {shortcutsOpen && <ShortcutsDialog />}
      <Toast />
      <ConfirmHost />
    </div>
  );
}
