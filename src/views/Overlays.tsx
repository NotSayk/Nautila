import { useEffect } from "react";
import { useT, type Key } from "../i18n";
import { fmtKeys } from "../util/platform";
import { useStore } from "../store";
import { openDailyNote } from "./daily";
import { Modal } from "./dialogs";

// `{mod}`, `{shift}`, `{alt}` et `{space}` s'adaptent à la plateforme et à la langue (voir fmtKeys).
const SHORTCUTS: [Key, [Key, string][]][] = [
  [
    "groupApp",
    [
      ["scSearch", "{mod} K"],
      ["scNewPage", "{mod} {alt} N"],
      ["dailyNote", "{mod} {alt} J"],
      ["scSidebar", "{mod} \\"],
      ["scTheme", "{mod} {shift} L"],
      ["scNewTab", "{mod} {alt} T"],
      ["scCloseTab", "{mod} {alt} W"],
      ["scSwitchTab", "{mod} {alt} ← / →"],
      ["scHistory", "{alt} ← / {alt} →"],
      ["scHelp", "{mod} /"],
    ],
  ],
  [
    "groupEditor",
    [
      ["scSlash", "/"],
      ["scMention", "@"],
      ["scFormat", "{mod} B / I / U"],
      ["scUndo", "{mod} Z / {mod} {shift} Z"],
      ["scIndent", "Tab / {shift} Tab"],
      ["scMarkdown", "#  -  []  >  ```"],
    ],
  ],
  ["groupReview", [["scReview", "{space}, 1 – 4"]]],
];

export function ShortcutsDialog() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const close = () => useStore.setState({ shortcutsOpen: false });
  return (
    <Modal position="center" label={t("shortcuts")} onClose={close} className="max-h-[85vh] w-full max-w-md overflow-y-auto p-5">
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
              <kbd className="shrink-0 rounded bg-hover px-1.5 py-0.5 font-sans text-xs text-muted">
                {fmtKeys(keys, lang)}
              </kbd>
            </div>
          ))}
        </section>
      ))}
    </Modal>
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
      className="fixed bottom-5 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-bg shadow-pop"
    >
      <span className="min-w-0">{toast.message}</span>
      {toast.action && (
        <button
          className="shrink-0 rounded px-1.5 font-semibold underline underline-offset-2"
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

/**
 * Raccourcis globaux de l'application. Sous Windows, AltGr arrive comme Ctrl+Alt : une combinaison
 * qui produit un caractère (ex. AltGr+N = « ń », AltGr+8 = « \ ») doit rester une saisie.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Déjà traité (lien de l'éditeur, champ…) : on ne le double pas.
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      const altGr = e.getModifierState?.("AltGraph") ?? false;
      const store = useStore.getState();
      const key = e.key.toLowerCase();
      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };
      // Une touche qui donne un autre caractère que la lettre du raccourci est une saisie.
      if (altGr && e.key.length === 1 && key !== e.code.replace(/^Key/, "").toLowerCase()) return;
      if (!e.altKey) {
        if (key === "k" && !e.shiftKey) run(() => store.setSearchOpen(true));
        else if (key === "\\") run(() => store.setSidebarOpen(!store.sidebarOpen));
        else if (key === "/") run(() => useStore.setState({ shortcutsOpen: true }));
        else if (key === "l" && e.shiftKey) run(store.toggleDark);
        return;
      }
      // Ctrl+N seul est réservé par les navigateurs (nouvelle fenêtre).
      if (e.code === "KeyN") run(() => void store.newPage({}).catch(() => undefined));
      else if (e.code === "KeyJ") run(() => void openDailyNote());
      // Ctrl+T et Ctrl+W seuls appartiennent au navigateur : les onglets passent par Ctrl+Alt.
      else if (key === "t" || e.code === "KeyT") run(() => store.openTab());
      else if (key === "w" || e.code === "KeyW") run(() => store.closeTab(store.tab));
      else if ((key === "arrowright" || key === "arrowleft") && store.tabs.length > 1)
        run(() =>
          store.selectTab((store.tab + (key === "arrowright" ? 1 : -1) + store.tabs.length) % store.tabs.length),
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
