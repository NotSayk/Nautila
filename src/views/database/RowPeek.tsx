import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../../i18n";
import { IconButton, PageIcon } from "../common";
import { RowFieldList } from "./RowProperties";
import { TitleInput } from "./Parts";
import type { Api } from "./shared";

/** Aperçu latéral d'une ligne : son nom et ses propriétés, avec un accès à la page entière. */
export function RowPeek({ api, rowId, onClose }: { api: Api; rowId: string; onClose: () => void }) {
  const t = useT();
  const row = api.rowById(rowId);
  const panel = useRef<HTMLElement>(null);
  // L'aperçu n'est pas modal : Échap le ferme depuis l'intérieur, et le focus revient à l'élément qui l'a ouvert.
  const opener = useRef(document.activeElement as HTMLElement | null).current;
  useEffect(
    () => () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    },
    [opener],
  );
  // La ligne a disparu (supprimée, synchronisation) : l'aperçu se ferme.
  useEffect(() => {
    if (!row) onClose();
  }, [row, onClose]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [rowId]);
  if (!row) return null;
  return (
    <aside
      ref={panel}
      role="dialog"
      aria-label={t("peekRow")}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-pop text-sm shadow-pop sm:w-[440px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 px-2 shadow-[inset_0_-1px_0_var(--color-line)]">
        <IconButton label={t("closePeek")} onClick={onClose}>
          <X size={16} />
        </IconButton>
        <span className="flex-1" />
        <button
          onClick={() => api.openPage(row.id)}
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-hover"
        >
          <ExternalLink size={14} />
          {t("openFullPage")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="mb-3 flex items-center gap-2 text-2xl">
          <PageIcon page={{ icon: row.icon, kind: "note" }} size={26} />
          <TitleInput row={row} api={api} className="h-10 text-2xl font-bold" />
        </div>
        <RowFieldList
          props={api.props}
          row={row}
          onValue={(prop, value) => void api.setValue(row, prop.id, value)}
          onOptions={(prop, options) => api.setOptions(prop.id, options)}
        />
      </div>
    </aside>
  );
}
