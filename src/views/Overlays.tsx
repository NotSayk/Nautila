import { useEffect } from "react";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const SHORTCUTS: [Key, [Key, string][]][] = [
  [
    "groupApp",
    [
      ["scSearch", `${MOD} K`],
      ["scNewPage", `${MOD} Alt N`],
      ["scSidebar", `${MOD} \\`],
      ["scTheme", `${MOD} Maj L`],
      ["scNewTab", `${MOD} Alt T`],
      ["scCloseTab", `${MOD} Alt W`],
      ["scSwitchTab", `${MOD} Alt ← / →`],
      ["scHistory", "Alt ← / Alt →"],
      ["scHelp", `${MOD} /`],
    ],
  ],
  [
    "groupEditor",
    [
      ["scSlash", "/"],
      ["scMention", "@"],
      ["scFormat", `${MOD} B / I / U`],
      ["scUndo", `${MOD} Z / ${MOD} Maj Z`],
      ["scIndent", "Tab / Maj Tab"],
      ["scMarkdown", "#  -  []  >  ```"],
    ],
  ],
  ["groupReview", [["scReview", "Espace, 1 – 4"]]],
];

export function ShortcutsDialog() {
  const t = useT();
  const close = () => useStore.setState({ shortcutsOpen: false });
  useOverlay(close);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcuts")}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-pop p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold">{t("shortcuts")}</p>
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group} className="mt-4">
            <p className="mb-1 text-xs font-medium text-muted">{t(group)}</p>
            {rows.map(([label, keys]) => (
              <div
                key={label}
                className="flex min-h-8 items-center justify-between gap-4 shadow-[inset_0_-1px_0_var(--color-line)]"
              >
                <span>{t(label)}</span>
                <kbd className="shrink-0 rounded bg-hover px-1.5 py-0.5 font-sans text-xs text-muted">{keys}</kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Message bref en bas de l'écran ; disparaît seul au bout de quelques secondes. */
export function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => useStore.setState({ toast: null }), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-bg shadow-pop"
    >
      {toast.message}
      {toast.action && (
        <button
          className="rounded px-1.5 font-semibold underline underline-offset-2"
          onClick={() => {
            toast.action!.run();
            useStore.setState({ toast: null });
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/** Raccourcis globaux de l'application. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const store = useStore.getState();
      const key = e.key.toLowerCase();
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };
      if (key === "k" && !e.shiftKey) run(() => store.setSearchOpen(true));
      else if (key === "\\") run(() => store.setSidebarOpen(!store.sidebarOpen));
      else if (key === "/") run(() => useStore.setState({ shortcutsOpen: true }));
      else if (key === "l" && e.shiftKey) run(store.toggleDark);
      // Ctrl+N seul est réservé par les navigateurs (nouvelle fenêtre).
      else if (e.altKey && e.code === "KeyN") run(() => void store.newPage({}));
      // Ctrl+T et Ctrl+W seuls appartiennent au navigateur : les onglets passent par Ctrl+Alt.
      else if (e.altKey && (key === "t" || e.code === "KeyT")) run(() => store.openTab());
      else if (e.altKey && (key === "w" || e.code === "KeyW")) run(() => store.closeTab(store.tab));
      else if (e.altKey && (key === "arrowright" || key === "arrowleft") && store.tabs.length > 1)
        run(() =>
          store.selectTab((store.tab + (key === "arrowright" ? 1 : -1) + store.tabs.length) % store.tabs.length),
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
