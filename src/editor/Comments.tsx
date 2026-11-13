import { Check, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { useT } from "../i18n";
import { useStore } from "../store";
import { relativeTime } from "../views/common";
import type { NautilaEditor } from "./schema";

type Comment = {
  id: string;
  blockId: string;
  quote: string;
  text: string;
  author: string;
  at: number;
  resolved: boolean;
};

/**
 * Commentaires d'une page. Ils sont rangés dans le document lui-même, donc
 * synchronisés et partagés avec lui, y compris en édition à plusieurs.
 */
export function Comments({
  doc,
  editor,
  open,
  author,
  editable,
  onCount,
  onClose,
}: {
  doc: Y.Doc;
  editor: NautilaEditor;
  open: boolean;
  author: string;
  editable: boolean;
  onCount?: (count: number) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const map = doc.getMap<Omit<Comment, "id">>("comments");
    const read = () => {
      const list = [...map.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => a.at - b.at);
      setComments(list);
      onCount?.(list.filter((c) => !c.resolved).length);
    };
    read();
    map.observe(read);
    return () => map.unobserve(read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const map = () => doc.getMap<Omit<Comment, "id">>("comments");
  const add = () => {
    const block = editor.getTextCursorPosition().block;
    const quote = Array.isArray(block.content)
      ? block.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : "")).join("")
      : "";
    map().set(crypto.randomUUID().slice(0, 8), {
      blockId: block.id,
      quote: quote.slice(0, 140),
      text: text.trim(),
      author,
      at: Date.now(),
      resolved: false,
    });
    setText("");
  };
  const show = (blockId: string) =>
    document.querySelector(`[data-id="${blockId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const open_ = comments.filter((c) => !c.resolved);
  return (
    <>
      {/* Les blocs commentés sont repérés par un fond, sans toucher au contenu. */}
      {open_.length > 0 && (
        <style>{`${open_.map((c) => `.bn-block-outer[data-id="${c.blockId}"] > .bn-block > .bn-block-content`).join(",")}{background:rgb(255 212 0 / 0.16);border-radius:3px}`}</style>
      )}
      {open && (
        <aside
          aria-label={t("comments")}
          className="no-print fixed bottom-0 right-0 top-11 z-20 flex w-80 max-w-full flex-col bg-pop shadow-pop"
        >
          <div className="flex h-11 items-center justify-between px-3 font-semibold">
            {t("comments")}
            <button
              aria-label={t("cancel")}
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
            {comments.length === 0 && <p className="text-muted">{t("commentNone")}</p>}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg p-2.5 shadow-[0_0_0_1px_var(--color-line)] ${c.resolved ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-1 text-xs text-muted">
                  <span className="font-semibold text-ink">{c.author}</span>
                  <span className="flex-1">
                    · {relativeTime(c.at, lang)}
                    {c.resolved ? ` · ${t("resolved")}` : ""}
                  </span>
                  {editable && (
                    <>
                      <button
                        title={t(c.resolved ? "reopen" : "resolve")}
                        aria-label={t(c.resolved ? "reopen" : "resolve")}
                        className="grid size-6 place-items-center rounded hover:bg-hover"
                        onClick={() => map().set(c.id, { ...c, resolved: !c.resolved })}
                      >
                        {c.resolved ? <RotateCcw size={13} /> : <Check size={14} />}
                      </button>
                      <button
                        title={t("delete")}
                        aria-label={t("delete")}
                        className="grid size-6 place-items-center rounded hover:bg-hover"
                        onClick={() => map().delete(c.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
                {c.quote && (
                  <button
                    onClick={() => show(c.blockId)}
                    className="mt-1 block w-full truncate border-l-2 border-[#f2c94c] pl-2 text-left text-xs text-muted hover:text-ink"
                  >
                    {c.quote}
                  </button>
                )}
                <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
          </div>
          {editable && (
            <form
              className="p-3 shadow-[inset_0_1px_0_var(--color-line)]"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) add();
              }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) add();
                }}
                rows={3}
                placeholder={t("commentPlaceholder")}
                aria-label={t("commentPlaceholder")}
                className="w-full resize-none rounded-md bg-hover p-2 placeholder:text-faint"
              />
              <button
                disabled={!text.trim()}
                className="mt-2 h-8 w-full rounded-md bg-accent font-medium text-white disabled:opacity-40"
              >
                {t("commentAdd")}
              </button>
            </form>
          )}
        </aside>
      )}
    </>
  );
}
