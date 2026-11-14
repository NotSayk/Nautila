import { restorePage, trashPage, type PageMeta } from "../data/pages";
import { subtreeIds } from "../data/tree";
import { translate } from "../i18n";
import { useStore, type Route } from "../store";

/** Met une page à la corbeille et propose d'annuler pendant quelques secondes. */
export async function moveToTrash(page: PageMeta) {
  const { navigate, refreshPages, refreshDue } = useStore.getState();
  // La page et toutes ses sous-pages disparaissent ensemble.
  const gone = subtreeIds(useStore.getState().pages, page.id);
  await trashPage(page.id);
  await refreshPages();
  await refreshDue();
  const { route, tabs, tab } = useStore.getState();
  // Les autres onglets ouverts sur la branche supprimée reviennent à l'accueil.
  const inTrash = (r: Route) => r.view === "page" && gone.has(r.id);
  if (tabs.some((r, i) => i !== tab && inTrash(r)))
    useStore.setState({ tabs: tabs.map((r, i) => (i !== tab && inTrash(r) ? ({ view: "home" } as Route) : r)) });
  if (inTrash(route)) navigate({ view: "home" });
  const lang = useStore.getState().lang;
  useStore.setState({
    toast: {
      message: translate(lang, "trashed"),
      action: {
        label: translate(lang, "undoAction"),
        run: async () => {
          await restorePage(page.id);
          await refreshPages();
          await refreshDue();
          navigate({ view: "page", id: page.id });
        },
      },
    },
  });
}
