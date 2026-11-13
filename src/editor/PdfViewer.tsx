import { Highlighter, Quote, Trash2 } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Zone surlignée : coordonnées en fraction de la page, donc indépendantes du zoom. */
export type Highlight = {
  id: string;
  page: number;
  text: string;
  rects: { x: number; y: number; w: number; h: number }[];
};

type Props = {
  src: string;
  highlights: Highlight[];
  editable: boolean;
  onChange: (highlights: Highlight[]) => void;
  /** Insère l'extrait dans la note, sous le document. */
  onQuote: (highlight: Highlight) => void;
};

function Page({
  preview,
  active,
  doc,
  number,
  width,
  highlights,
}: {
  doc: pdfjs.PDFDocumentProxy;
  number: number;
  width: number;
  highlights: Highlight[];
  preview?: Highlight;
  active?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; scale: number }>();

  useEffect(() => {
    let live = true;
    let task: pdfjs.RenderTask | undefined;
    (async () => {
      const page = await doc.getPage(number);
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      if (!live || !canvas.current || !text.current) return;
      setSize({ w: viewport.width, h: viewport.height, scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.current.width = viewport.width * ratio;
      canvas.current.height = viewport.height * ratio;
      task = page.render({
        canvas: canvas.current,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise.catch(() => undefined);
      if (!live) return;
      text.current.replaceChildren();
      await new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text.current,
        viewport,
      }).render();
    })();
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, number, width]);

  return (
    <div
      data-page={number}
      className="pdf-page"
      style={{
        width: size?.w ?? width,
        height: size?.h ?? width * 1.414,
        ["--total-scale-factor" as string]: size?.scale ?? 1,
      }}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      {[...highlights, ...(preview ? [preview] : [])].flatMap((h) =>
        h.rects.map((r, i) => (
          <span
            key={h.id + i}
            className={
              h === preview ? "pdf-highlight pdf-selecting" : h.id === active ? "pdf-highlight pdf-highlight-on" : "pdf-highlight"
            }
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          />
        )),
      )}
      <div ref={text} className="pdf-text" />
    </div>
  );
}

export default function PdfViewer({ src, highlights, editable, onChange, onQuote }: Props) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy>();
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ highlight: Highlight; left: number; top: number } | null>(null);
  // Surlignage cliqué : on peut le retirer ou le citer.
  const [active, setActive] = useState<{ id: string; left: number; top: number } | null>(null);
  // Historique des surlignages de ce document, pour Ctrl+Z / Ctrl+Maj+Z.
  const past = useRef<Highlight[][]>([]);
  const future = useRef<Highlight[][]>([]);
  const setToast = (message: string, undo: () => void) =>
    useStore.setState({ toast: { message, action: { label: t("undoAction"), run: undo } } });

  const commit = (next: Highlight[]) => {
    past.current = [...past.current.slice(-49), highlights];
    future.current = [];
    onChange(next);
  };
  const undo = () => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(highlights);
    setActive(null);
    onChange(previous);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(highlights);
    setActive(null);
    onChange(next);
  };
  const remove = (id: string) => {
    commit(highlights.filter((h) => h.id !== id));
    setActive(null);
    setToast(t("highlightRemoved"), undo);
  };

  // Raccourcis, quand le document a le focus (après un clic dedans).
  const onKeyDown = (e: KeyboardEvent) => {
    if (!editable) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && key === "z" && !e.shiftKey) undo();
    else if (mod && ((key === "z" && e.shiftKey) || key === "y")) redo();
    else if ((e.key === "Delete" || e.key === "Backspace") && active) remove(active.id);
    else if (e.key === "Escape" && (active || pending)) {
      setActive(null);
      setPending(null);
    } else handled = false;
    // L'éditeur ne doit pas annuler, lui, la dernière modification du texte de la page.
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;

  useEffect(() => {
    const task = pdfjs.getDocument({ url: src });
    task.promise.then(setDoc, () => setFailed(true));
    return () => void task.destroy();
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(el.clientWidth - 24)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // L'éditeur ne doit pas voir ces clics : il sélectionnerait le bloc au lieu du texte.
    // (Le gestionnaire est donc branché ici, et non par React, qui écoute plus haut.)
    const stop = (e: MouseEvent) => {
      e.stopPropagation();
      downRef.current(e);
    };
    // Les raccourcis valent tant que ce document est le dernier endroit cliqué : l'éditeur
    // garde le focus du clavier, on les intercepte donc avant lui.
    let current = false;
    const track = (e: MouseEvent) => (current = el.contains(e.target as Node));
    const key = (e: KeyboardEvent) => current && keyRef.current(e);
    el.addEventListener("mousedown", stop);
    document.addEventListener("mousedown", track, true);
    window.addEventListener("keydown", key, true);
    return () => {
      observer.disconnect();
      el.removeEventListener("mousedown", stop);
      document.removeEventListener("mousedown", track, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  // L'éditeur garde la main sur la sélection du navigateur : on la reconstruit
  // donc nous-mêmes, du point où la souris est enfoncée à celui où elle se trouve.
  const caretAt = (x: number, y: number): [Node, number] | null => {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = d.caretPositionFromPoint?.(x, y);
    if (position) return [position.offsetNode, position.offset];
    const range = d.caretRangeFromPoint?.(x, y);
    return range ? [range.startContainer, range.startOffset] : null;
  };

  const onMouseDown = (down: MouseEvent) => {
    const container = box.current;
    if (!editable || !container || !(down.target as Element).closest(".pdf-text")) return;
    down.preventDefault();
    setPending(null);
    setActive(null);
    const start = caretAt(down.clientX, down.clientY);
    const page = (down.target as Element).closest<HTMLElement>("[data-page]");
    if (!start || !page) return;
    let moved = false;

    const select = (e: MouseEvent) => {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 3) moved = true;
      if (!moved) return;
      const end = caretAt(e.clientX, e.clientY);
      if (!end || !page.contains(end[0])) return;
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      // Sélection tracée de droite à gauche : on inverse les bornes.
      if (range.collapsed) {
        range.setStart(...end);
        range.setEnd(...start);
      }
      const content = range.toString().replace(/\s+/g, " ").trim();
      const frame = page.getBoundingClientRect();
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({
          x: (r.left - frame.left) / frame.width,
          y: (r.top - frame.top) / frame.height,
          w: r.width / frame.width,
          h: r.height / frame.height,
        }));
      if (!content || rects.length === 0) return setPending(null);
      const last = range.getBoundingClientRect();
      const outer = container.getBoundingClientRect();
      setPending({
        highlight: { id: crypto.randomUUID().slice(0, 8), page: Number(page.dataset.page), text: content, rects },
        left: Math.min(Math.max(last.left - outer.left + container.scrollLeft, 8), Math.max(8, outer.width - 130)),
        top: last.bottom - outer.top + container.scrollTop + 6,
      });
    };
    const stop = (up: MouseEvent) => {
      window.removeEventListener("mousemove", select);
      if (moved) return;
      // Simple clic : sur un surlignage, on le sélectionne.
      const frame = page.getBoundingClientRect();
      const x = (up.clientX - frame.left) / frame.width;
      const y = (up.clientY - frame.top) / frame.height;
      const hit = highlights.find(
        (h) =>
          h.page === Number(page.dataset.page) &&
          h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y - 0.003 && y <= r.y + r.h + 0.003),
      );
      if (!hit) return;
      const outer = container.getBoundingClientRect();
      setActive({
        id: hit.id,
        left: Math.min(Math.max(up.clientX - outer.left + container.scrollLeft - 60, 8), Math.max(8, outer.width - 200)),
        top: up.clientY - outer.top + container.scrollTop + 14,
      });
    };
    window.addEventListener("mousemove", select);
    window.addEventListener("mouseup", stop, { once: true });
  };

  const downRef = useRef(onMouseDown);
  downRef.current = onMouseDown;

  const add = () => {
    if (!pending) return;
    commit([...highlights, pending.highlight]);
    setPending(null);
  };
  const activeHighlight = active && highlights.find((h) => h.id === active.id);

  return (
    <div>
      <div ref={box} className="pdf-box">
        {failed && <p className="p-4 text-(--color-muted)">{t("pdfError")}</p>}
        {doc &&
          width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <Page
              key={i}
              doc={doc}
              number={i + 1}
              width={width}
              highlights={highlights.filter((h) => h.page === i + 1)}
              preview={pending?.highlight.page === i + 1 ? pending.highlight : undefined}
              active={active?.id}
            />
          ))}
        {pending && (
          <button
            className="pdf-add"
            style={{ left: pending.left, top: pending.top }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={add}
          >
            <Highlighter size={14} />
            {t("highlight")}
          </button>
        )}
        {active && activeHighlight && (
          <div className="pdf-add pdf-menu" style={{ left: active.left, top: active.top }} role="menu">
            <button role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => remove(active.id)}>
              <Trash2 size={14} />
              {t("removeHighlight")}
            </button>
            <button
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onQuote(activeHighlight);
                setActive(null);
              }}
            >
              <Quote size={14} />
              {t("quoteInNote")}
            </button>
          </div>
        )}
      </div>
      {highlights.length > 0 && (
        <ul className="pdf-notes">
          {highlights.map((h) => (
            <li key={h.id}>
              <button
                className="pdf-note-text"
                onClick={() =>
                  box.current
                    ?.querySelector(`[data-page="${h.page}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span className="pdf-note-page">p. {h.page}</span>
                {h.text}
              </button>
              {editable && (
                <>
                  <button
                    className="sketch-tool"
                    title={t("quoteInNote")}
                    aria-label={t("quoteInNote")}
                    onClick={() => onQuote(h)}
                  >
                    <Quote size={14} />
                  </button>
                  <button
                    className="sketch-tool"
                    title={t("delete")}
                    aria-label={t("delete")}
                    onClick={() => remove(h.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
