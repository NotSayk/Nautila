import { useEffect, useState } from "react";
import { deletePageForever, listTrash, restorePage, type PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon, View } from "./common";

export function Trash() {
  const t = useT();
  const [items, setItems] = useState<PageMeta[]>([]);

  const reload = async () => {
    setItems(await listTrash());
    await useStore.getState().refreshPages();
    await useStore.getState().refreshDue();
  };
  useEffect(() => void listTrash().then(setItems), []);

  return (
    <View title={t("trash")}>
      {items.length === 0 && <p className="text-sm text-muted">{t("trashEmpty")}</p>}
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-hover">
          <PageIcon page={p} />
          <span className="min-w-0 flex-1 truncate">{p.title || t("untitled")}</span>
          <button
            onClick={async () => {
              await restorePage(p.id);
              await reload();
            }}
            className="rounded px-2 py-1 font-medium text-accent hover:bg-line"
          >
            {t("restore")}
          </button>
          <button
            onClick={async () => {
              if (!confirm(t("confirmDeleteForever"))) return;
              await deletePageForever(p.id);
              await reload();
            }}
            className="rounded px-2 py-1 text-red-600 hover:bg-line dark:text-red-400"
          >
            {t("deleteForever")}
          </button>
        </div>
      ))}
    </View>
  );
}
