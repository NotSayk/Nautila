import { dailyNote } from "../data/daily";
import { translate } from "../i18n";
import { useStore } from "../store";
import { notify } from "./dialogs";

/** Ouvre la note du jour (barre latérale et raccourci), en la créant au besoin. */
export async function openDailyNote() {
  const { lang } = useStore.getState();
  try {
    const id = await dailyNote(lang, translate(lang, "journal"));
    await useStore.getState().refreshPages();
    useStore.getState().navigate({ view: "page", id });
  } catch {
    notify(translate(lang, "dailyNoteFailed"));
  }
}
