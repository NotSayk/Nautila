import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState } from "react";
import { OPTION_COLORS, type Option } from "../../data/dbquery";
import { moveItem } from "../../data/dbview";
import { useT } from "../../i18n";
import { IconButton } from "../common";
import { COLOR_NAMES, uid } from "./shared";

/** Palette des couleurs d'étiquette. */
function Palette({ color, onPick }: { color: string; onPick: (color: string) => void }) {
  const t = useT();
  return (
    <div role="group" aria-label={t("optionColor")} className="flex flex-wrap gap-1 px-1 pb-1 pt-0.5">
      {OPTION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={t(COLOR_NAMES[c] ?? "colorGray")}
          title={t(COLOR_NAMES[c] ?? "colorGray")}
          aria-pressed={c === color}
          onClick={() => onPick(c)}
          className={`tag tag-${c} grid size-6 place-items-center rounded-md p-0 ${c === color ? "ring-2 ring-accent" : ""}`}
        >
          {c === color && "✓"}
        </button>
      ))}
    </div>
  );
}

/** Édition des options d'une sélection : nom, couleur, ordre (flèches ou glisser-déposer) et suppression. */
export function OptionsEditor({ options, onChange }: { options: Option[]; onChange: (options: Option[]) => void }) {
  const t = useT();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [paletteId, setPaletteId] = useState<string | null>(null);
  const patch = (id: string, change: Partial<Option>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...change } : o)));
  const reorder = (id: string, beforeId: string | null) =>
    onChange(
      moveItem(
        options.map((o) => o.id),
        id,
        beforeId,
      ).map((x) => options.find((o) => o.id === x)!),
    );
  const move = (id: string, delta: -1 | 1) => {
    const ids = options.map((o) => o.id);
    const at = ids.indexOf(id) + delta;
    if (at >= 0 && at < ids.length) reorder(id, delta < 0 ? ids[at] : (ids[at + 1] ?? null));
  };

  return (
    <div className="space-y-0.5">
      {options.map((o, i) => (
        <div key={o.id}>
          <div
            draggable
            onDragStart={() => setDragId(o.id)}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(o.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== o.id) reorder(dragId, o.id);
              setDragId(null);
              setOverId(null);
            }}
            className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-1 rounded px-1 ${
              overId === o.id && dragId !== o.id ? "bg-hover" : ""
            }`}
          >
            <button
              type="button"
              aria-label={`${t("optionColor")} : ${t(COLOR_NAMES[o.color] ?? "colorGray")}`}
              title={t("optionColor")}
              aria-expanded={paletteId === o.id}
              onClick={() => setPaletteId(paletteId === o.id ? null : o.id)}
              className={`tag tag-${o.color} size-6 shrink-0 rounded-md p-0`}
            />
            <input
              aria-label={t("optionName")}
              defaultValue={o.name}
              onBlur={(e) =>
                e.target.value.trim() && e.target.value !== o.name && patch(o.id, { name: e.target.value.trim() })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") {
                  e.stopPropagation();
                  e.currentTarget.value = o.name;
                  e.currentTarget.blur();
                }
              }}
              className="h-7 min-w-0 rounded bg-transparent px-1.5 hover:bg-hover focus:bg-hover"
            />
            <IconButton
              label={t("moveUp")}
              disabled={i === 0}
              onClick={() => move(o.id, -1)}
              className="size-6 disabled:opacity-30"
            >
              <ArrowUp size={13} />
            </IconButton>
            <IconButton
              label={t("moveDown")}
              disabled={i === options.length - 1}
              onClick={() => move(o.id, 1)}
              className="size-6 disabled:opacity-30"
            >
              <ArrowDown size={13} />
            </IconButton>
            <IconButton
              label={t("delete")}
              onClick={() => onChange(options.filter((x) => x.id !== o.id))}
              className="size-6"
            >
              <X size={13} />
            </IconButton>
          </div>
          {paletteId === o.id && (
            <Palette
              color={o.color}
              onPick={(color) => {
                patch(o.id, { color });
                setPaletteId(null);
              }}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        className="flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-muted hover:bg-hover"
        onClick={() =>
          onChange([
            ...options,
            {
              id: uid(),
              name: `${t("optionName")} ${options.length + 1}`,
              color: OPTION_COLORS[options.length % OPTION_COLORS.length],
            },
          ])
        }
      >
        <Plus size={14} />
        {t("addOption")}
      </button>
    </div>
  );
}
