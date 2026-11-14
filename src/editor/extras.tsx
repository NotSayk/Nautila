import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { FileUp, Trash2 } from "lucide-react";
import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from "react";
import { getPageDoc } from "../data/pages";
import { citeLabel, deleteRef, importRefs, listRefs, refDetails, type Reference } from "../data/refs";
import { useT } from "../i18n";
import { Popover } from "../views/common";

// ---------- Références bibliographiques ----------
const REFS_EVENT = "nautila-refs";
let cache: Promise<Reference[]> | null = null;
const refreshRefs = () => {
  cache = null;
  window.dispatchEvent(new Event(REFS_EVENT));
};

/** Bibliothèque de références, partagée par toutes les citations affichées. */
function useRefs(): Reference[] {
  const [refs, setRefs] = useState<Reference[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void (cache ??= listRefs()).then((list) => live && setRefs(list));
    load();
    window.addEventListener(REFS_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(REFS_EVENT, load);
    };
  }, []);
  return refs;
}

function RefPicker({
  anchor,
  onClose,
  onPick,
}: {
  anchor: DOMRect;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  const t = useT();
  const and = t("refAnd");
  const refs = useRefs();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const shown = refs.filter((r) => `${r.key} ${r.author} ${r.title} ${r.year}`.toLowerCase().includes(q));
  return (
    <Popover anchor={anchor} onClose={onClose} width={340}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("refSearch")}
        className="mb-1 h-7 w-full rounded bg-hover px-2 placeholder:text-faint"
      />
      <div className="max-h-60 overflow-y-auto">
        {refs.length === 0 && <p className="px-2 py-1 text-muted">{t("refEmpty")}</p>}
        {shown.map((r) => (
          <div key={r.key} className="group flex items-center rounded hover:bg-hover">
            <button
              className="min-w-0 flex-1 px-2 py-1 text-left"
              onClick={() => {
                onClose();
                onPick(r.key);
              }}
            >
              <span className="block truncate font-medium">{citeLabel(r, and)}</span>
              <span className="block truncate text-xs text-muted">{r.title || r.key}</span>
            </button>
            <button
              aria-label={t("delete")}
              title={t("delete")}
              className="mr-1 hidden size-6 place-items-center rounded text-muted hover:bg-active group-hover:grid"
              onClick={async () => {
                await deleteRef(r.key);
                refreshRefs();
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="mt-1 flex h-7 w-full items-center gap-2 rounded px-2 text-muted hover:bg-hover"
        onClick={() => input.current?.click()}
      >
        <FileUp size={15} />
        {t("refImport")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".bib,.bibtex,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          await importRefs(await file.text());
          refreshRefs();
        }}
      />
    </Popover>
  );
}

/**
 * Une citation vide ne propose le choix de la référence qu'à l'insertion locale : le menu de l'éditeur
 * le demande juste avant d'insérer. Au rechargement, à la recréation de l'éditeur ou à l'arrivée d'une
 * citation vide insérée par un autre, rien ne s'ouvre.
 */
let citePickerAsked = 0;
export const askCitePicker = () => void (citePickerAsked = Date.now());
const takeCitePicker = () => {
  const asked = Date.now() - citePickerAsked < 2000;
  citePickerAsked = 0;
  return asked;
};

/** Citation dans le texte : « (Auteur, année) ». */
export const Cite = createReactInlineContentSpec(
  { type: "cite", propSchema: { key: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent, updateInlineContent, editor }) => {
      const t = useT();
      const and = t("refAnd");
      const refs = useRefs();
      const key = inlineContent.props.key;
      const ref = refs.find((r) => r.key === key);
      const [anchor, setAnchor] = useState<DOMRect | null>(null);
      const self = useRef<HTMLSpanElement>(null);
      // Une citation tout juste insérée (par cet utilisateur) ouvre le choix de la référence.
      useEffect(() => {
        if (!key && editor.isEditable && self.current && takeCitePicker())
          setAnchor(self.current.getBoundingClientRect());
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <span
          ref={self}
          className="cite"
          contentEditable={false}
          title={ref ? `${ref.author} — ${ref.title}` : undefined}
          onClick={(e) => editor.isEditable && setAnchor(e.currentTarget.getBoundingClientRect())}
        >
          ({ref ? citeLabel(ref, and) : key || t("refChoose")})
          {anchor && (
            <RefPicker
              anchor={anchor}
              onClose={() => setAnchor(null)}
              onPick={(k) => updateInlineContent({ type: "cite", props: { key: k } })}
            />
          )}
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => <span>[@{inlineContent.props.key}]</span>,
  },
);

function citedKeys(blocks: any[], out = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (Array.isArray(b.content))
      for (const c of b.content) if (c.type === "cite" && c.props?.key) out.add(c.props.key);
    if (b.children?.length) citedKeys(b.children, out);
  }
  return out;
}

/** Bibliographie : la liste des références citées dans la page, tenue à jour. */
export const Bibliography = createReactBlockSpec(
  { type: "bibliography", propSchema: {}, content: "none" },
  {
    render: ({ editor }) => {
      const t = useT();
      const refs = useRefs();
      const [keys, setKeys] = useState<Set<string>>(() => citedKeys(editor.document));
      useEffect(() => {
        const refresh = () => setKeys(citedKeys(editor.document));
        refresh();
        return editor.onChange(refresh);
      }, [editor]);
      const cited = refs.filter((r) => keys.has(r.key));
      return (
        <div className="bibliography" contentEditable={false}>
          {cited.length === 0 && <span className="math-empty">{t("bibEmpty")}</span>}
          {cited.map((r) => {
            const d = refDetails(r);
            // « Revue, 12(3), 45–67 » : seulement ce que l'entrée renseigne.
            const where = [d.venue, d.volume && `${d.volume}${d.number ? `(${d.number})` : ""}`, d.pages]
              .filter(Boolean)
              .join(", ");
            return (
              <p key={r.key}>
                {r.author || r.key}
                {r.year && ` (${r.year})`}. <em>{r.title}</em>.{where && ` ${where}.`}
              </p>
            );
          })}
        </div>
      );
    },
    toExternalHTML: () => <p />,
  },
);

// ---------- Bloc synchronisé ----------
// Chargé à la demande : l'éditeur importe ce fichier, qui ne peut donc pas l'importer directement.
const PageEditor = lazy(() => import("./PageEditor").then((m) => ({ default: m.PageEditor })));

/**
 * Contenus déjà affichés autour d'un éditeur (la page, puis chaque bloc synchronisé imbriqué) :
 * un bloc synchronisé qui renverrait à l'un d'eux (collé dans sa propre source, ou A→B→A) se
 * rendrait à l'infini.
 */
export const SyncChain = createContext<readonly string[]>([]);

/**
 * Bloc synchronisé : son contenu vit dans une page cachée. Copié-collé ailleurs,
 * le bloc affiche et modifie le même contenu.
 */
export const SyncedBlock = createReactBlockSpec(
  { type: "syncedBlock", propSchema: { sourceId: { default: "" } }, content: "none" },
  {
    render: ({ block, editor }) => {
      const t = useT();
      const id = block.props.sourceId;
      const chain = useContext(SyncChain);
      const cycle = chain.includes(id);
      const [doc, setDoc] = useState<{ ydoc: string | null }>();
      useEffect(() => {
        let live = true;
        if (id && !cycle) void getPageDoc(id).then((d) => live && setDoc(d));
        return () => {
          live = false;
        };
      }, [id, cycle]);
      if (cycle)
        return (
          <p className="media-missing" contentEditable={false}>
            {t("syncedCycle")}
          </p>
        );
      return (
        <div className="synced" contentEditable={false} title={t("syncedHint")}>
          {doc && (
            <Suspense fallback={null}>
              <PageEditor pageId={id} initialDoc={doc.ydoc} editable={editor.isEditable} embedded />
            </Suspense>
          )}
        </div>
      );
    },
    toExternalHTML: () => <p />,
  },
);
