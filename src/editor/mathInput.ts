import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";

/** Caractère qui remplace un nœud en ligne (lien de page, formule…) dans le texte d'un bloc. */
const OPAQUE = String.fromCharCode(0xfffc);

/**
 * Formule en ligne qui se termine avec le texte `before` (le `$` fermant vient d'être tapé) :
 * `$x^2` → { offset: position du `$` ouvrant, latex: "x^2" }.
 * Ni espace juste après l'ouvrant, ni juste avant le fermant : « 5$ et 10$ » reste du texte.
 * L'ouvrant doit suivre un début de texte, une espace ou une ponctuation ouvrante (pas `\$`).
 */
export function matchInlineMath(before: string): { offset: number; latex: string } | null {
  const m = /(^|[\s([{"'«])\$([^\s$](?:[^$]*[^\s$])?)$/.exec(before);
  if (!m) return null;
  return { offset: m.index + m[1].length, latex: m[2] };
}

/**
 * Saisie des maths au clavier :
 * - `$$` dans un bloc vide devient un bloc de formule (déjà en édition) ;
 * - `$x^2$` dans du texte devient une formule en ligne.
 * Les deux passent par des transactions ordinaires : annulation (Ctrl+Z) et collaboration restent intactes.
 */
export const mathInput = createExtension({
  key: "mathInput",
  inputRules: [
    {
      find: /^\$\$$/,
      replace: ({ editor }) => {
        const { block } = editor.getTextCursorPosition();
        const text = Array.isArray(block.content)
          ? block.content.map((c) => ("text" in c && typeof c.text === "string" ? c.text : OPAQUE)).join("")
          : "";
        // Le premier `$` est déjà dans le bloc : tout autre contenu empêche la transformation.
        return text === "$" ? { type: "mathBlock" } : undefined;
      },
    },
  ],
  prosemirrorPlugins: [
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== "$" || from !== to || view.composing) return false;
          const { state } = view;
          const $from = state.doc.resolve(from);
          const parent = $from.parent;
          const math = state.schema.nodes.math;
          if (!math || !parent.isTextblock || parent.type.spec.code || parent.type.name === "codeBlock") return false;
          // Texte du bloc avant le curseur ; les nœuds en ligne (liens de page…) comptent pour un caractère opaque.
          const before = parent.textBetween(0, $from.parentOffset, undefined, OPAQUE);
          const found = matchInlineMath(before);
          if (!found) return false;
          // Pas de formule par-dessus du texte en code.
          const start = from - (before.length - found.offset);
          const code = state.schema.marks.code;
          if (code && state.doc.rangeHasMark(start, from, code)) return false;
          const node = math.create({ latex: found.latex });
          const tr = state.tr.replaceWith(start, from, node);
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
  ],
});
