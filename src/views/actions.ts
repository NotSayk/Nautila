import { restorePage, trashPage, type PageMeta } from "../data/pages";
import { translate } from "../i18n";
import { useStore } from "../store";

/** Met une page à la corbeille et propose d'annuler pendant quelques secondes. */
export async function moveToTrash(page: PageMeta) {
  const { route, navigate, refreshPages, refreshDue } = useStore.getState();
  await trashPage(page.id);
  await refreshPages();
  await refreshDue();
  if (route.view === "page" && route.id === page.id) navigate({ view: "home" });
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
