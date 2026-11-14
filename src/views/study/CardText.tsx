import katex from "katex";
import "katex/dist/katex.min.css";
import { memo, useMemo } from "react";
import { clozeOf, parseCloze, type CardLike } from "../../data/cloze";
import { splitMath } from "../../data/mathtext";

/**
 * Formule rendue par KaTeX. Le texte d'une carte peut venir d'un autre compte (partage) ou du
 * connecteur MCP : `trust: false` refuse \href, \htmlClass et consorts, les limites bornent le
 * travail demandé, et toute erreur s'affiche comme texte échappé. C'est le seul HTML injecté ici.
 */
const Tex = memo(function Tex({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: "ignore",
        maxSize: 20,
        maxExpand: 300,
      }),
    [tex, display],
  );
  return (
    <span
      className={display ? "my-1 block max-w-full overflow-x-auto overflow-y-hidden" : ""}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

/** Texte avec formules `$…$` et `$$…$$` ; le reste est du texte ordinaire (échappé par React). */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  return (
    <>
      {parts.map((p, i) => (p.kind === "text" ? <span key={i}>{p.text}</span> : <Tex key={i} tex={p.tex} display={p.display} />))}
    </>
  );
}

const GAP = "rounded bg-accent/15 px-1 font-semibold text-accent-text";
const SHOWN = "rounded bg-[#fbf3db] px-0.5 text-[#402c1b] dark:bg-[#564328] dark:text-white";

/**
 * Texte d'une carte, trous compris. `gap` : numéro du trou à masquer (null : tous), `reveal` : trou
 * dévoilé et mis en évidence. Sans `gap`, les trous sont simplement soulignés (liste des cartes).
 */
export function ClozeText({ text, gap, reveal }: { text: string; gap?: number | null; reveal?: boolean }) {
  const parts = useMemo(() => parseCloze(text), [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "text") return <MathText key={i} text={p.text} />;
        if (gap === undefined)
          return (
            <span key={i} className="underline decoration-accent decoration-dotted underline-offset-4">
              <MathText text={p.answer} />
            </span>
          );
        if (gap !== null && p.n !== gap) return <MathText key={i} text={p.answer} />;
        return reveal ? (
          <mark key={i} className={SHOWN}>
            <MathText text={p.answer} />
          </mark>
        ) : (
          <span key={i} className={GAP}>
            [{p.hint ? <MathText text={p.hint} /> : "…"}]
          </span>
        );
      })}
    </>
  );
}

/** Recto d'une carte, trou masqué. */
export function CardFront({ card }: { card: CardLike }) {
  const { cloze, n } = clozeOf(card);
  return cloze ? <ClozeText text={card.front} gap={n} /> : <MathText text={card.front} />;
}

/** Verso d'une carte : pour une carte à trous, le texte au trou dévoilé, puis le verso s'il y en a un. */
export function CardBack({ card }: { card: CardLike }) {
  const { cloze, n } = clozeOf(card);
  if (!cloze) return <MathText text={card.back} />;
  return (
    <>
      <ClozeText text={card.front} gap={n} reveal />
      {card.back.trim() && (
        <span className="mt-3 block text-[0.8em] font-normal text-muted">
          <MathText text={card.back} />
        </span>
      )}
    </>
  );
}
