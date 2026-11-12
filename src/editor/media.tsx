import { createReactBlockSpec } from "@blocknote/react";
import { Eraser, FileUp, Mic, Square, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveFileUrl, saveFile } from "../data/files";
import { useT } from "../i18n";

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

/** Document PDF affiché dans la page par le lecteur du navigateur. */
export const PdfBlock = createReactBlockSpec(
  { type: "pdf", propSchema: { url: { default: "" }, name: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const src = useFileUrl(block.props.url);
      const input = useRef<HTMLInputElement>(null);
      return (
        <div className="media-block" contentEditable={false}>
          {block.props.url ? (
            <>
              <p className="mb-1 truncate text-[13px] text-(--color-muted)">{block.props.name}</p>
              {src && <iframe title={block.props.name} src={src} className="h-[70vh] w-full rounded" />}
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
                    editor.updateBlock(block, { props: { url: await saveFile(file), name: file.name } });
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
    toExternalHTML: ({ block }) => <p>{block.props.name}</p>,
  },
);

type Stroke = { d: string; color: string };
const INK = ["currentColor", "#d44c47", "#2383e2", "#448361"];
const SIZE = { w: 800, h: 360 };

/** Croquis à main levée, enregistré sous forme de tracés vectoriels. */
export const Sketch = createReactBlockSpec(
  { type: "sketch", propSchema: { strokes: { default: "[]" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const strokes: Stroke[] = JSON.parse(block.props.strokes);
      const [color, setColor] = useState(INK[0]);
      const [current, setCurrent] = useState<Stroke | null>(null);
      const save = (next: Stroke[]) => editor.updateBlock(block, { props: { strokes: JSON.stringify(next) } });
      // Sans cela, l'éditeur sélectionne le bloc au premier clic et le trait en cours est perdu.
      const svg = useRef<SVGSVGElement>(null);
      useEffect(() => {
        const stop = (e: Event) => e.stopPropagation();
        const el = svg.current;
        el?.addEventListener("mousedown", stop);
        return () => el?.removeEventListener("mousedown", stop);
      }, []);

      // Coordonnées dans le repère du dessin, quelle que soit la taille affichée.
      const point = (e: React.PointerEvent<SVGSVGElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - box.left) / box.width) * SIZE.w;
        const y = ((e.clientY - box.top) / box.height) * SIZE.h;
        return `${x.toFixed(1)} ${y.toFixed(1)}`;
      };

      return (
        <div className="media-block sketch" contentEditable={false}>
          <svg
            ref={svg}
            viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
            className="w-full touch-none"
            style={{ cursor: editor.isEditable ? "crosshair" : "default" }}
            onPointerDown={(e) => {
              if (!editor.isEditable) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setCurrent({ d: `M${point(e)}`, color });
            }}
            onPointerMove={(e) => current && setCurrent({ ...current, d: `${current.d} L${point(e)}` })}
            onPointerUp={() => {
              if (current) save([...strokes, current]);
              setCurrent(null);
            }}
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
