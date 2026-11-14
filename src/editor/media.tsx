import { createReactBlockSpec } from "@blocknote/react";
import { Download, Eraser, FileUp, Mic, Pause, PencilLine, Play, Square, Undo2, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { resolveFileUrl, saveFile } from "../data/files";
import { useT } from "../i18n";
import { notify } from "../views/dialogs";
import { useStore } from "../store";
import { hitsPath, simplify, toPath, type Pt } from "./geometry";
import { DEFAULT_STROKE_WIDTH, parseHighlights, parseStrokes, type Stroke } from "./parse";

/** Adresse affichable d'un fichier de la page ; `missing` quand il n'existe (plus) nulle part. */
function useFileUrl(url: string): { src: string; missing: boolean } {
  const [state, setState] = useState({ src: "", missing: false });
  useEffect(() => {
    let live = true;
    if (!url) {
      setState({ src: "", missing: false });
      return;
    }
    setState({ src: "", missing: false });
    resolveFileUrl(url).then(
      (src) => live && setState({ src, missing: !src }),
      () => live && setState({ src: "", missing: true }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

type Orphan = { file: File; href: string };

/** Enregistrement audio (prise de notes en cours), stocké dans la base locale. */
export const AudioNote = createReactBlockSpec(
  { type: "audioNote", propSchema: { url: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const { src, missing } = useFileUrl(block.props.url);
      const recorder = useRef<MediaRecorder | null>(null);
      const [status, setStatus] = useState<"idle" | "rec" | "paused">("idle");
      const [seconds, setSeconds] = useState(0);
      const [error, setError] = useState(false);
      // Enregistrement trop gros pour la base : gardé en mémoire le temps de le télécharger.
      const [orphan, setOrphan] = useState<Orphan | null>(null);

      useEffect(() => {
        if (status !== "rec") return;
        const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
        return () => clearInterval(timer);
      }, [status]);
      // Quitter la page pendant un enregistrement libère le micro.
      useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);
      useEffect(
        () => () => {
          if (orphan) URL.revokeObjectURL(orphan.href);
        },
        [orphan],
      );

      const start = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const chunks: Blob[] = [];
          const rec = new MediaRecorder(stream);
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            setStatus("idle");
            const type = rec.mimeType || "audio/webm";
            const file = new File(chunks, `audio.${type.includes("mp4") ? "m4a" : "webm"}`, { type });
            try {
              const url = await saveFile(file);
              editor.updateBlock(block.id, { props: { url } });
            } catch {
              // Rien n'est perdu : l'enregistrement reste téléchargeable.
              setOrphan({ file, href: URL.createObjectURL(file) });
              useStore.setState({ toast: { message: t("recordingTooLarge") } });
            }
          };
          recorder.current = rec;
          rec.start();
          setError(false);
          setOrphan(null);
          setSeconds(0);
          setStatus("rec");
        } catch {
          setError(true);
        }
      };

      const togglePause = () => {
        const rec = recorder.current;
        if (!rec) return;
        if (status === "rec") {
          rec.pause();
          setStatus("paused");
        } else if (status === "paused") {
          rec.resume();
          setStatus("rec");
        }
      };

      return (
        <div className="media-block" contentEditable={false}>
          {block.props.url ? (
            missing ? (
              <p className="media-missing">{t("fileMissing")}</p>
            ) : (
              <audio controls src={src} className="w-full" />
            )
          ) : status !== "idle" ? (
            <div className="flex items-center gap-2">
              <span
                className={`size-2.5 shrink-0 rounded-full bg-danger ${status === "rec" ? "animate-pulse" : "opacity-40"}`}
                aria-hidden
              />
              <span className="min-w-14 font-mono text-[13px] tabular-nums" role="timer" aria-live="off">
                {clock(seconds)}
              </span>
              {status === "paused" && <span className="text-[13px] text-(--color-muted)">{t("recordingPaused")}</span>}
              <button className="media-action w-auto" onClick={togglePause}>
                {status === "rec" ? <Pause size={14} /> : <Play size={14} />}
                {t(status === "rec" ? "pauseRecording" : "resumeRecording")}
              </button>
              <button className="media-action w-auto" onClick={() => recorder.current?.stop()}>
                <Square size={14} className="fill-current text-danger" />
                {t("stopRecording")}
              </button>
            </div>
          ) : (
            <>
              <button className="media-action" onClick={start} disabled={!editor.isEditable}>
                <Mic size={16} />
                {t(error ? "micBlocked" : "startRecording")}
              </button>
              {orphan && (
                <div className="media-missing mt-1 flex flex-wrap items-center gap-2" role="alert">
                  {t("recordingTooLarge")}
                  <a className="media-action w-auto" href={orphan.href} download={orphan.file.name}>
                    <Download size={14} />
                    {t("downloadRecording")}
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      );
    },
    toExternalHTML: () => <p />,
  },
);

const PdfViewer = lazy(() => import("./PdfViewer"));

/** Document PDF affiché dans la page, avec surlignage du texte. */
export const PdfBlock = createReactBlockSpec(
  {
    type: "pdf",
    propSchema: { url: { default: "" }, name: { default: "" }, highlights: { default: "[]" } },
    content: "none",
  },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const { src, missing } = useFileUrl(block.props.url);
      const input = useRef<HTMLInputElement>(null);
      const highlights = parseHighlights(block.props.highlights);
      return (
        <div className="media-block" contentEditable={false}>
          {block.props.url ? (
            <>
              <p className="mb-1 truncate text-[13px] text-(--color-muted)">{block.props.name}</p>
              {missing && <p className="media-missing">{t("fileMissing")}</p>}
              {src && (
                <Suspense fallback={null}>
                  <PdfViewer
                    src={src}
                    name={block.props.name}
                    highlights={highlights}
                    editable={editor.isEditable}
                    onChange={(next) => editor.updateBlock(block.id, { props: { highlights: JSON.stringify(next) } })}
                    onQuote={(h) =>
                      // Le type de l'éditeur est restreint à ce bloc ; la citation existe dans le schéma complet.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (editor as any).insertBlocks(
                        [{ type: "quote", content: `${h.text} (${block.props.name}, p. ${h.page})` }],
                        block.id,
                        "after",
                      )
                    }
                  />
                </Suspense>
              )}
            </>
          ) : (
            <>
              <button className="media-action" onClick={() => input.current?.click()} disabled={!editor.isEditable}>
                <FileUp size={16} />
                {t("choosePdf")}
              </button>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    editor.updateBlock(block.id, { props: { url: await saveFile(file), name: file.name } });
                  } catch {
                    notify(t("fileTooLarge"));
                  }
                }}
              />
            </>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <div>
        <p>{block.props.name}</p>
        {parseHighlights(block.props.highlights).map((h) => (
          <blockquote key={h.id}>
            {h.text} (p. {h.page})
          </blockquote>
        ))}
      </div>
    ),
  },
);

const INK = ["currentColor", "#d44c47", "#2383e2", "#448361"];
/** Épaisseurs proposées (unités du dessin) ; 2,5 est celle des croquis d'avant. */
const WIDTHS = [1.5, DEFAULT_STROKE_WIDTH, 5];
const SIZE = { w: 800, h: 360 };

/** Tracé en cours : ses points sont gardés bruts, puis simplifiés à la fin du geste. */
type Draft = { color: string; w: number; pts: Pt[] };

// Le trait en cours vit hors du composant : l'éditeur peut remonter le bloc
// pendant le tracé (sélection, insertion) sans que le trait soit perdu.
const drafts = new Map<string, Draft>();
const DRAFT_EVENT = "nautila-sketch";

/** Croquis à main levée, enregistré sous forme de tracés vectoriels. */
export const Sketch = createReactBlockSpec(
  { type: "sketch", propSchema: { strokes: { default: "[]" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const id = block.id;
      const strokes = parseStrokes(block.props.strokes);
      const [color, setColor] = useState(INK[0]);
      const [width, setWidth] = useState(DEFAULT_STROKE_WIDTH);
      const [erasing, setErasing] = useState(false);
      const [, redraw] = useState(0);
      const draft = drafts.get(id);
      const current: Stroke | undefined = draft && { d: toPath(draft.pts), color: draft.color, w: draft.w };
      const save = (next: Stroke[]) => editor.updateBlock(id, { props: { strokes: JSON.stringify(next) } });

      useEffect(() => {
        const onDraft = () => redraw((n) => n + 1);
        window.addEventListener(DRAFT_EVENT, onDraft);
        return () => window.removeEventListener(DRAFT_EVENT, onDraft);
      }, []);

      // Dans la zone de dessin, un tracé n'est jamais un clic ni un glisser-déposer pour l'éditeur :
      // sans cela, il sélectionne le bloc, ou le navigateur commence à déplacer tout le bloc
      // (le trait est alors interrompu, et le bloc déposé ailleurs en double).
      // Le bloc se déplace avec sa poignée, à gauche, comme les autres.
      const svg = useRef<SVGSVGElement>(null);
      useEffect(() => {
        const el = svg.current;
        if (!el) return;
        const stop = (e: Event) => {
          e.stopPropagation();
          if (e.type !== "mousedown" || editor.isEditable) e.preventDefault();
        };
        const events = ["mousedown", "dragstart", "drop", "dragover"];
        for (const type of events) el.addEventListener(type, stop);
        return () => events.forEach((type) => el.removeEventListener(type, stop));
      }, [editor]);

      const begin = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!editor.isEditable) return;
        // Coordonnées dans le repère du dessin, quelle que soit la taille affichée.
        const point = (ev: { clientX: number; clientY: number }): Pt => {
          const box = (document.querySelector(`[data-sketch="${id}"]`) ?? e.currentTarget).getBoundingClientRect();
          return {
            x: ((ev.clientX - box.left) / box.width) * SIZE.w,
            y: ((ev.clientY - box.top) / box.height) * SIZE.h,
          };
        };
        const notify = () => window.dispatchEvent(new Event(DRAFT_EVENT));
        const latestStrokes = () => {
          const latest = editor.getBlock(id);
          return latest ? parseStrokes((latest.props as { strokes: string }).strokes) : null;
        };
        // Un seul tracé à la fois ; le doigt ou le stylet ne fait pas défiler la page pendant le dessin.
        if (drafts.has(id) || (e.pointerType === "mouse" && e.button !== 0)) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);

        if (erasing) {
          // Gomme : tout trait touché disparaît.
          const erase = (ev: { clientX: number; clientY: number }) => {
            const list = latestStrokes();
            if (!list) return;
            const p = point(ev);
            const kept = list.filter((s) => !hitsPath(s.d, p, 7 + (s.w ?? DEFAULT_STROKE_WIDTH) / 2));
            if (kept.length !== list.length) save(kept);
          };
          const move = (ev: PointerEvent) => erase(ev);
          const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
          };
          erase(e);
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end);
          window.addEventListener("pointercancel", end);
          return;
        }

        const move = (ev: PointerEvent) => {
          const d = drafts.get(id);
          if (!d) return;
          const p = point(ev);
          const last = d.pts[d.pts.length - 1];
          // Les points quasi confondus n'apportent rien.
          if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.8) d.pts.push(p);
          notify();
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          const d = drafts.get(id);
          drafts.delete(id);
          const list = latestStrokes();
          if (d && list) {
            // Un simple appui laisse un point : deux points identiques, que le trait arrondi dessine.
            const pts = d.pts.length === 1 ? [d.pts[0], d.pts[0]] : simplify(d.pts);
            save([...list, { d: toPath(pts), color: d.color, w: d.w }]);
          }
          notify();
        };
        drafts.set(id, { color, w: width, pts: [point(e)] });
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        // Tracé interrompu par le système (geste, changement de fenêtre) : il est gardé tel quel.
        window.addEventListener("pointercancel", end);
        notify();
      };

      return (
        <div className="media-block sketch" contentEditable={false}>
          <svg
            ref={svg}
            data-sketch={id}
            viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
            className="w-full touch-none"
            style={{ cursor: editor.isEditable ? (erasing ? "cell" : "crosshair") : "default" }}
            onPointerDown={begin}
          >
            {[...strokes, ...(current ? [current] : [])].map((s, i) => (
              <path
                key={i}
                d={s.d}
                stroke={s.color}
                strokeWidth={s.w ?? DEFAULT_STROKE_WIDTH}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {editor.isEditable && (
            <div className="sketch-tools">
              <button
                className={`sketch-tool ${erasing ? "" : "sketch-tool-on"}`}
                title={t("pen")}
                aria-label={t("pen")}
                aria-pressed={!erasing}
                onClick={() => setErasing(false)}
              >
                <PencilLine size={15} />
              </button>
              {INK.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => {
                    setColor(c);
                    setErasing(false);
                  }}
                  className={`sketch-color ${c === color && !erasing ? "sketch-color-on" : ""}`}
                  style={{ background: c }}
                />
              ))}
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  className={`sketch-tool ${w === width && !erasing ? "sketch-tool-on" : ""}`}
                  title={`${t("strokeWidth")} : ${w}`}
                  aria-label={`${t("strokeWidth")} : ${w}`}
                  aria-pressed={w === width}
                  onClick={() => {
                    setWidth(w);
                    setErasing(false);
                  }}
                >
                  <span className="rounded-full bg-current" style={{ width: 4 + w * 1.6, height: 4 + w * 1.6 }} />
                </button>
              ))}
              <button
                className={`sketch-tool ${erasing ? "sketch-tool-on" : ""}`}
                title={t("eraser")}
                aria-label={t("eraser")}
                aria-pressed={erasing}
                onClick={() => setErasing(!erasing)}
              >
                <Eraser size={15} />
              </button>
              <button
                className="sketch-tool"
                title={t("undo")}
                aria-label={t("undo")}
                onClick={() => save(strokes.slice(0, -1))}
              >
                <Undo2 size={15} />
              </button>
              <button className="sketch-tool" title={t("clear")} aria-label={t("clear")} onClick={() => save([])}>
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <svg viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} xmlns="http://www.w3.org/2000/svg">
        {parseStrokes(block.props.strokes).map((s, i) => (
          <path
            key={i}
            d={s.d}
            stroke={s.color}
            strokeWidth={s.w ?? DEFAULT_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </svg>
    ),
  },
);
