import { useEffect, useState } from "react";
import { deletePageForever, listTrash, restorePage, type PageMeta } from "../data/pages";
import { emptyTrash } from "../data/trash";
import { useT } from "../i18n";
import { useStore } from "../store";
import { PageIcon, relativeTime, View } from "./common";
import { confirmDialog, notify } from "./dialogs";

export function Trash() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  // null : chargement en cours (à distinguer d'une corbeille vide).
  const [items, setItems] = useState<PageMeta[] | null>(null);

  const reload = async () => {
    setItems(await listTrash());
    await useStore.getState().refreshPages();
    await useStore.getState().refreshDue();
  };
  // Recharge aussi quand les pages changent ailleurs (mise à la corbeille, annulation).
  const pages = useStore((s) => s.pages);
  useEffect(() => void listTrash().then(setItems), [pages]);

  const action = "h-7 rounded-md px-2 hover:bg-active";

  return (
    <View
      title={t("trash")}
      right={
        items && items.length > 0 ? (
          <button
            className={`${action} text-danger`}
            onClick={async () => {
              if (!(await confirmDialog({ message: t("confirmEmptyTrash"), confirmLabel: t("emptyTrash"), danger: true })))
                return;
              await emptyTrash();
              await reload();
              notify(t("trashEmptied"));
            }}
          >
            {t("emptyTrash")}
          </button>
        ) : undefined
      }
    >
      <p className="-mt-4 mb-6 text-muted">{t("trashAutoPurge")}</p>
      {items === null && (
        <p role="status" className="text-muted">
          {t("loading")}
        </p>
      )}
      {items?.length === 0 && <p className="text-muted">{t("trashEmpty")}</p>}
      <div className="-mx-2">
        {items?.map((p) => (
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
                if (!(await confirmDialog({ message: t("confirmDeleteForever"), confirmLabel: t("deleteForever"), danger: true })))
                  return;
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
