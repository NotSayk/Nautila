import { useEffect, useState } from "react";
import { deletePageForever, listTrash, restorePage, type PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon, relativeTime, View } from "./common";

export function Trash() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [items, setItems] = useState<PageMeta[]>([]);

  const reload = async () => {
    setItems(await listTrash());
    await useStore.getState().refreshPages();
    await useStore.getState().refreshDue();
  };
  useEffect(() => void listTrash().then(setItems), []);

  const action = "h-7 rounded-md px-2 hover:bg-active";

  return (
    <View title={t("trash")}>
      {items.length === 0 && <p className="text-muted">{t("trashEmpty")}</p>}
      <div className="-mx-2">
        {items.map((p) => (
          <div key={p.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-hover">
            <PageIcon page={p} />
            <span className="min-w-0 flex-1 truncate font-medium">{p.title || t("untitled")}</span>
            <span className="text-xs text-faint max-sm:hidden">{relativeTime(p.deleted_at!, lang)}</span>
            <button
              onClick={async () => {
                await restorePage(p.id);
                await reload();
              }}
              className={action}
            >
              {t("restore")}
            </button>
            <button
              onClick={async () => {
                if (!confirm(t("confirmDeleteForever"))) return;
                await deletePageForever(p.id);
                await reload();
              }}
              className={`${action} text-danger`}
            >
              {t("deleteForever")}
            </button>
          </div>
        ))}
      </div>
    </View>
  );
}
