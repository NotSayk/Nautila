import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { initDb, isTauri } from "./db";
import { useT } from "./i18n";
import { useStore } from "./store";
import { Dashboard } from "./views/Dashboard";
import { Timetable } from "./views/Timetable";
import { notifyDueTasks } from "./reminders";
import { startSync } from "./sync/engine";
import { JoinView, PublicView } from "./views/ShareDialog";
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

type Status = { state: "loading" } | { state: "ready"; persistent: boolean } | { state: "error"; message: string };

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

  useEffect(() => {
    (opening ??= initDb()).then(
      async (db) => {
        await Promise.all([useStore.getState().refreshPages(), useStore.getState().refreshDue()]);
        setStatus({ state: "ready", persistent: db.persistent });
        void notifyDueTasks();
        void startSync();
      },
      (err) => setStatus({ state: "error", message: String(err?.message ?? err) }),
    );
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.lang = lang;
  }, [dark, lang]);

  useGlobalShortcuts();

  if (status.state === "loading") return <div className="grid h-full place-items-center text-faint">Nautila</div>;
  if (status.state === "error")
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="font-medium">{t("loadError")}</p>
          <p className="mt-2 text-muted">{status.message}</p>
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
          {!status.persistent && (
            <div className="bg-[#fbf3db] px-4 py-2 text-[#402c1b] dark:bg-[#564328] dark:text-white/85">
              {t("notPersistent")}
            </div>
          )}
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
    </div>
  );
}
