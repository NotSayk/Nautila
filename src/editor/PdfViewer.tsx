import { Download, Highlighter, Maximize2, Quote, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from "./parse";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { Highlight };

const COLOR_LABEL: Record<HighlightColor, Key> = {
  yellow: "hlYellow",
  green: "hlGreen",
  blue: "hlBlue",
  pink: "hlPink",
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
/** Les pages à moins de cette distance de la zone visible sont rendues d'avance. */
const RENDER_MARGIN = "800px 0px";

type Props = {
  src: string;
  /** Nom du fichier, proposé au téléchargement. */
  name?: string;
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
  ratio,
  root,
  onRatio,
  highlights,
}: {
  doc: pdfjs.PDFDocumentProxy;
  number: number;
  width: number;
  /** Hauteur / largeur de la page, connue ou estimée : l'espace reste réservé hors de l'écran. */
  ratio: number;
  root: HTMLElement;
  onRatio: (number: number, ratio: number) => void;
  highlights: Highlight[];
  preview?: Highlight;
  active?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [visible, setVisible] = useState(false);

  // Seules les pages proches de la zone visible sont dessinées : un PDF de 200 pages ne sature pas la mémoire.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root,
      rootMargin: RENDER_MARGIN,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  // Page qui sort de la zone : on libère son dessin, l'espace réservé reste.
  useEffect(() => {
    if (visible) return;
    if (canvas.current) {
      canvas.current.width = 0;
      canvas.current.height = 0;
    }
    text.current?.replaceChildren();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    let task: pdfjs.RenderTask | undefined;
    (async () => {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      if (!live || !canvas.current || !text.current) return;
      setScale(scale);
      onRatio(number, base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.current.width = viewport.width * dpr;
      canvas.current.height = viewport.height * dpr;
      task = page.render({
        canvas: canvas.current,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await task.promise.catch(() => undefined);
      if (!live) return;
      text.current.replaceChildren();
      await new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: text.current,
        viewport,
      }).render();
    })().catch(() => undefined);
    return () => {
      live = false;
      task?.cancel();
    };
    // `onRatio` est stable pour la vie du document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, number, width, visible]);

  return (
    <div
      ref={frame}
      data-page={number}
      className="pdf-page"
      style={{
        width,
        height: width * ratio,
        ["--total-scale-factor" as string]: scale,
      }}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      {[...highlights, ...(preview ? [preview] : [])].flatMap((h) =>
        h.rects.map((r, i) => (
          <span
            key={h.id + i}
            className={
              h === preview
                ? "pdf-highlight pdf-selecting"
                : `pdf-highlight pdf-hl-${h.color ?? "yellow"}${h.id === active ? " pdf-highlight-on" : ""}`
            }
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          />
        )),
      )}
      <div ref={text} className="pdf-text" />
    </div>
  );
}

export default function PdfViewer({ src, name, highlights, editable, onChange, onQuote }: Props) {
  const t = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy>();
  const [fitWidth, setFitWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(1);
  const [color, setColor] = useState<HighlightColor>("yellow");
  const [pending, setPending] = useState<{ highlight: Highlight; left: number; top: number } | null>(null);
  // Surlignage cliqué : on peut le retirer, le citer ou changer sa couleur.
  const [active, setActive] = useState<{ id: string; left: number; top: number } | null>(null);
  // Proportions des pages connues ; celles qu'on n'a pas encore vues prennent celles de la première.
  const ratios = useRef(new Map<number, number>());
  const [, setRatioVersion] = useState(0);
  // Historique des surlignages de ce document, pour Ctrl+Z / Ctrl+Maj+Z.
  const past = useRef<Highlight[][]>([]);
  const future = useRef<Highlight[][]>([]);
  const setToast = (message: string, undo: () => void) =>
    useStore.setState({ toast: { message, action: { label: t("undoAction"), run: undo } } });

  const width = Math.round(fitWidth * zoom);

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

  // Chargement du document. Changer de source détruit l'ancien document et repart de zéro.
  useEffect(() => {
    let live = true;
    setFailed(false);
    setDoc(undefined);
    ratios.current = new Map();
    const task = pdfjs.getDocument({ url: src });
    task.promise.then(
      async (loaded) => {
        const first = await loaded.getPage(1).catch(() => null);
        if (!live) return;
        if (first) {
          const v = first.getViewport({ scale: 1 });
          ratios.current.set(0, v.height / v.width);
        }
        setDoc(loaded);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      void task.destroy();
    };
  }, [src]);

  // Largeur disponible, mesurée avec un délai : redimensionner la fenêtre ne re-rend pas les pages à chaque pas.
  useEffect(() => {
    const el = boxEl;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => setFitWidth(Math.max(240, Math.floor(el.clientWidth - 24)));
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    });
    observer.observe(el);
    // L'éditeur ne doit pas voir ces clics : il sélectionnerait le bloc au lieu du texte.
    // (Le gestionnaire est donc branché ici, et non par React, qui écoute plus haut.)
    const stop = (e: MouseEvent) => {
      e.stopPropagation();
      downRef.current(e);
    };
    // Les raccourcis valent tant que ce document est le dernier endroit cliqué : l'éditeur
    // garde le focus du clavier, on les intercepte donc avant lui.
    let last = false;
    const track = (e: MouseEvent) => (last = el.contains(e.target as Node));
    const key = (e: KeyboardEvent) => last && keyRef.current(e);
    // Page courante, d'après la position de défilement.
    let frameId = 0;
    const onScroll = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        let found = 1;
        for (const page of el.querySelectorAll<HTMLElement>("[data-page]")) {
          if (page.offsetTop > el.scrollTop + el.clientHeight / 3) break;
          found = Number(page.dataset.page);
        }
        setCurrent(found);
      });
    };
    el.addEventListener("mousedown", stop);
    el.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mousedown", track, true);
    window.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frameId);
      observer.disconnect();
      el.removeEventListener("mousedown", stop);
      el.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousedown", track, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [boxEl]);

  // Zoom : on garde la même partie du document à l'écran.
  const anchor = useRef<number | null>(null);
  const changeZoom = (next: number) => {
    const el = box.current;
    if (el && el.scrollHeight > 0) anchor.current = el.scrollTop / el.scrollHeight;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };
  useLayoutEffect(() => {
    const el = box.current;
    if (el && anchor.current !== null) el.scrollTop = anchor.current * el.scrollHeight;
    anchor.current = null;
  }, [width]);

  const goTo = (page: number) => {
    const el = box.current;
    const target = el?.querySelector<HTMLElement>(`[data-page="${Math.min(Math.max(1, page), doc?.numPages ?? 1)}"]`);
    if (el && target) el.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
  };

  const onRatio = (number: number, ratio: number) => {
    const known = ratios.current.get(number);
    if (known !== undefined && Math.abs(known - ratio) < 0.001) return;
    ratios.current.set(number, ratio);
    setRatioVersion((n) => n + 1);
  };

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
        highlight: {
          id: crypto.randomUUID().slice(0, 8),
          page: Number(page.dataset.page),
          text: content,
          rects,
          color,
        },
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
        left: Math.min(
          Math.max(up.clientX - outer.left + container.scrollLeft - 60, 8),
          Math.max(8, outer.width - 260),
        ),
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
  const fallbackRatio = ratios.current.get(0) ?? 1.414;
  const swatches = (selected: HighlightColor | undefined, onPick: (c: HighlightColor) => void) =>
    HIGHLIGHT_COLORS.map((c) => (
      <button
        key={c}
        role="menuitemradio"
        aria-checked={c === selected}
        title={t(COLOR_LABEL[c])}
        aria-label={t(COLOR_LABEL[c])}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(c)}
        className={`pdf-swatch pdf-hl-${c} ${c === selected ? "pdf-swatch-on" : ""}`}
      />
    ));

  return (
    <div>
      {doc && (
        <div className="pdf-toolbar no-print">
          <button
            className="sketch-tool"
            title={t("pdfZoomOut")}
            aria-label={t("pdfZoomOut")}
            onClick={() => changeZoom(zoom / ZOOM_STEP)}
          >
            <ZoomOut size={15} />
          </button>
          <span className="pdf-zoom">{Math.round(zoom * 100)} %</span>
          <button
            className="sketch-tool"
            title={t("pdfZoomIn")}
            aria-label={t("pdfZoomIn")}
            onClick={() => changeZoom(zoom * ZOOM_STEP)}
          >
            <ZoomIn size={15} />
          </button>
          <button
            className="sketch-tool"
            title={t("pdfFitWidth")}
            aria-label={t("pdfFitWidth")}
            onClick={() => changeZoom(1)}
          >
            <Maximize2 size={14} />
          </button>
          <span className="pdf-sep" />
          <label className="pdf-page-input">
            <span className="sr-only">{t("pdfGoToPage")}</span>
            <input
              key={current}
              type="number"
              min={1}
              max={doc.numPages}
              defaultValue={current}
              title={t("pdfGoToPage")}
              onKeyDown={(e) => e.key === "Enter" && goTo(Number(e.currentTarget.value) || 1)}
              onBlur={(e) => Number(e.currentTarget.value) !== current && goTo(Number(e.currentTarget.value) || 1)}
            />
            / {doc.numPages}
          </label>
          <a
            className="sketch-tool"
            href={src}
            download={name || "document.pdf"}
            title={t("pdfDownload")}
            aria-label={t("pdfDownload")}
          >
            <Download size={15} />
          </a>
          {editable && (
            <>
              <span className="pdf-sep" />
              <span role="menu" aria-label={t("highlightColor")} className="flex items-center gap-1.5">
                {swatches(color, setColor)}
              </span>
            </>
          )}
        </div>
      )}
      <div
        ref={(el) => {
          box.current = el;
          setBoxEl(el);
        }}
        className="pdf-box"
      >
        {failed && <p className="p-4 text-(--color-muted)">{t("pdfError")}</p>}
        {doc &&
          boxEl &&
          width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <Page
              key={i}
              doc={doc}
              number={i + 1}
              width={width}
              ratio={ratios.current.get(i + 1) ?? fallbackRatio}
              root={boxEl}
              onRatio={onRatio}
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
            <span className="flex items-center gap-1.5 px-2">
              {swatches(activeHighlight.color ?? "yellow", (c) =>
                commit(highlights.map((h) => (h.id === activeHighlight.id ? { ...h, color: c } : h))),
              )}
            </span>
          </div>
        )}
      </div>
      {highlights.length > 0 && (
        <ul className="pdf-notes">
          {highlights.map((h) => (
            <li key={h.id}>
              <button className={`pdf-note-text pdf-hl-${h.color ?? "yellow"}`} onClick={() => goTo(h.page)}>
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
