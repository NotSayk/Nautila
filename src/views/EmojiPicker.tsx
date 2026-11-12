import { loadFrimousseData, searchEmojis, type FrimousseEmojiData } from "@blocknote/core/emoji-data";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Popover } from "./common";

const cache = new Map<string, Promise<FrimousseEmojiData>>();

export function EmojiPicker({
  anchor,
  onClose,
  onPick,
  onRemove,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onPick: (emoji: string) => void;
  onRemove?: () => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [data, setData] = useState<FrimousseEmojiData>();
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    if (!cache.has(lang)) cache.set(lang, loadFrimousseData(lang));
    cache.get(lang)!.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [lang]);

  const groups = useMemo(() => {
    if (!data) return [];
    if (query.trim()) return [{ label: "", emojis: searchEmojis(data.emojis, query, lang).slice(0, 120) }];
    return data.categories.map((c) => ({ label: c.label, emojis: data.emojis.filter((e) => e.category === c.index) }));
  }, [data, query, lang]);

  const pick = (emoji: string) => {
    onClose();
    onPick(emoji);
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={344}>
      <div className="flex items-center gap-1 p-1">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="h-7 min-w-0 flex-1 rounded bg-hover px-2 placeholder:text-faint"
        />
        {onRemove && (
          <button
            className="h-7 rounded px-2 text-muted hover:bg-hover"
            onClick={() => {
              onClose();
              onRemove();
            }}
          >
            {t("removeIcon")}
          </button>
        )}
      </div>
      <div className="h-72 overflow-y-auto px-1 pb-1">
        {groups.map((g) => (
          <section key={g.label} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}>
            {g.label && <p className="px-1 pb-1 pt-2 text-xs text-faint first-letter:uppercase">{g.label}</p>}
            <div className="grid grid-cols-9">
              {g.emojis.map((e) => (
                <button
                  key={e.emoji}
                  title={e.label}
                  onClick={() => pick(e.emoji)}
                  className="grid size-9 place-items-center rounded text-[22px] leading-none hover:bg-hover"
                >
                  {e.emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
        {data && query.trim() && groups[0].emojis.length === 0 && <p className="p-2 text-muted">{t("noResults")}</p>}
      </div>
    </Popover>
  );
}
