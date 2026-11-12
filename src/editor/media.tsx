import { createReactBlockSpec } from "@blocknote/react";
import { Eraser, FileUp, Mic, Square, Undo2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { resolveFileUrl, saveFile } from "../data/files";
import { useT } from "../i18n";
import type { Highlight } from "./PdfViewer";

function useFileUrl(url: string) {
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    let live = true;
    if (url) resolveFileUrl(url).then((u) => live && setResolved(u));
    else setResolved("");
    return () => {
      live = false;
    };
  }, [url]);
  return resolved;
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Enregistrement audio (prise de notes en cours), stocké dans la base locale. */
export const AudioNote = createReactBlockSpec(
  { type: "audioNote", propSchema: { url: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const src = useFileUrl(block.props.url);
      const recorder = useRef<MediaRecorder | null>(null);
      const [seconds, setSeconds] = useState<number | null>(null);
      const [error, setError] = useState(false);

      useEffect(() => {
        if (seconds === null) return;
        const timer = setInterval(() => setSeconds((s) => (s === null ? s : s + 1)), 1000);
        return () => clearInterval(timer);
      }, [seconds === null]);
      // Quitter la page pendant un enregistrement libère le micro.
      useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);

      const start = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const chunks: Blob[] = [];
          const rec = new MediaRecorder(stream);
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            setSeconds(null);
            const type = rec.mimeType || "audio/webm";
            const url = await saveFile(new File(chunks, `audio.${type.includes("mp4") ? "m4a" : "webm"}`, { type }));
            editor.updateBlock(block, { props: { url } });
          };
          recorder.current = rec;
          rec.start();
          setError(false);
          setSeconds(0);
        } catch {
          setError(true);
        }
      };

      return (
        <div className="media-block" contentEditable={false}>
          {block.props.url ? (
            <audio controls src={src} className="w-full" />
          ) : seconds !== null ? (
            <button className="media-action" onClick={() => recorder.current?.stop()}>
              <Square size={14} className="fill-current text-danger" />
              {t("stopRecording")} · {clock(seconds)}
            </button>
          ) : (
            <button className="media-action" onClick={start} disabled={!editor.isEditable}>
              <Mic size={16} />
              {t(error ? "micBlocked" : "startRecording")}
            </button>
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
      const src = useFileUrl(block.props.url);
      const input = useRef<HTMLInputElement>(null);
      const highlights: Highlight[] = JSON.parse(block.props.highlights);
      return (
        <div className="media-block" contentEditable={false}>
          {block.props.url ? (
            <>
              <p className="mb-1 truncate text-[13px] text-(--color-muted)">{block.props.name}</p>
              {src && (
                <Suspense fallback={null}>
                  <PdfViewer
                    src={src}
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
                    alert(t("fileTooLarge"));
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
        {(JSON.parse(block.props.highlights) as Highlight[]).map((h) => (
          <blockquote key={h.id}>
            {h.text} (p. {h.page})
          </blockquote>
        ))}
      </div>
    ),
  },
);

type Stroke = { d: string; color: string };
const INK = ["currentColor", "#d44c47", "#2383e2", "#448361"];
const SIZE = { w: 800, h: 360 };

// Le trait en cours vit hors du composant : l'éditeur peut remonter le bloc
// pendant le tracé (sélection, insertion) sans que le trait soit perdu.
const drafts = new Map<string, Stroke>();
const DRAFT_EVENT = "nautila-sketch";

/** Croquis à main levée, enregistré sous forme de tracés vectoriels. */
export const Sketch = createReactBlockSpec(
  { type: "sketch", propSchema: { strokes: { default: "[]" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const id = block.id;
      const strokes: Stroke[] = JSON.parse(block.props.strokes);
      const [color, setColor] = useState(INK[0]);
      const [, redraw] = useState(0);
      const current = drafts.get(id);
      const save = (next: Stroke[]) => editor.updateBlock(id, { props: { strokes: JSON.stringify(next) } });

      useEffect(() => {
        const onDraft = () => redraw((n) => n + 1);
        window.addEventListener(DRAFT_EVENT, onDraft);
        return () => window.removeEventListener(DRAFT_EVENT, onDraft);
      }, []);

      // Sans cela, l'éditeur sélectionne le bloc au clic au lieu de laisser dessiner.
      const svg = useRef<SVGSVGElement>(null);
      useEffect(() => {
        const stop = (e: Event) => e.stopPropagation();
        const el = svg.current;
        el?.addEventListener("mousedown", stop);
        return () => el?.removeEventListener("mousedown", stop);
      }, []);

      const begin = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!editor.isEditable) return;
        // Coordonnées dans le repère du dessin, quelle que soit la taille affichée.
        const point = (ev: { clientX: number; clientY: number }) => {
          const box = (document.querySelector(`[data-sketch="${id}"]`) ?? e.currentTarget).getBoundingClientRect();
          const x = ((ev.clientX - box.left) / box.width) * SIZE.w;
          const y = ((ev.clientY - box.top) / box.height) * SIZE.h;
          return `${x.toFixed(1)} ${y.toFixed(1)}`;
        };
        const notify = () => window.dispatchEvent(new Event(DRAFT_EVENT));
        const move = (ev: PointerEvent) => {
          const draft = drafts.get(id);
          if (draft) drafts.set(id, { ...draft, d: `${draft.d} L${point(ev)}` });
          notify();
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          const draft = drafts.get(id);
          drafts.delete(id);
          const latest = editor.getBlock(id);
          if (draft && latest) save([...JSON.parse((latest.props as { strokes: string }).strokes), draft]);
          notify();
        };
        drafts.set(id, { d: `M${point(e)}`, color });
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        notify();
      };

      return (
        <div className="media-block sketch" contentEditable={false}>
          <svg
            ref={svg}
            data-sketch={id}
            viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
            className="w-full touch-none"
            style={{ cursor: editor.isEditable ? "crosshair" : "default" }}
            onPointerDown={begin}
          >
            {[...strokes, ...(current ? [current] : [])].map((s, i) => (
              <path
                key={i}
                d={s.d}
                stroke={s.color}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {editor.isEditable && (
            <div className="sketch-tools">
              {INK.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`sketch-color ${c === color ? "sketch-color-on" : ""}`}
                  style={{ background: c }}
                />
              ))}
              <button
                className="sketch-tool"
                title={t("undo")}
                aria-label={t("undo")}
                onClick={() => save(strokes.slice(0, -1))}
              >
                <Undo2 size={15} />
              </button>
              <button className="sketch-tool" title={t("clear")} aria-label={t("clear")} onClick={() => save([])}>
                <Eraser size={15} />
              </button>
            </div>
          )}
        </div>
      );
    },
    toExternalHTML: ({ block }) => (
      <svg viewBox={`0 0 ${SIZE.w} ${SIZE.h}`} xmlns="http://www.w3.org/2000/svg">
        {(JSON.parse(block.props.strokes) as Stroke[]).map((s, i) => (
          <path key={i} d={s.d} stroke={s.color} strokeWidth={2.5} fill="none" />
        ))}
      </svg>
    ),
  },
);
