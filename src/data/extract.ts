/** Fonctions pures qui tirent du contenu d'une page ce qu'on indexe en base. */

type AnyBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
};

export type ExtractedCard = { id: string; front: string; back: string };
/** `files` : identifiants des fichiers locaux utilisés par les blocs. */
export type Extracted = { body: string; cards: ExtractedCard[]; links: string[]; files: string[] };

const FILE_SCHEME = "nautila-file:";

function inlineText(content: unknown, links: Set<string>): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => inlineText(c, links)).join("");
  if (typeof content !== "object") return "";
  const node = content as Record<string, any>;
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "link":
      return inlineText(node.content, links);
    case "pageLink":
      if (node.props?.pageId) links.add(node.props.pageId);
      return "";
    case "math":
      return node.props?.latex ?? "";
    case "cite":
      return node.props?.key ? `[@${node.props.key}]` : "";
    case "tableContent":
      return (node.rows ?? [])
        .map((r: any) => (r.cells ?? []).map((c: unknown) => inlineText(c, links)).join(" "))
        .join("\n");
    case "tableCell":
      return inlineText(node.content, links);
    default:
      return "";
  }
}

export function extract(blocks: AnyBlock[]): Extracted {
  const lines: string[] = [];
  const cards: ExtractedCard[] = [];
  const links = new Set<string>();
  const files = new Set<string>();

  const walk = (list: AnyBlock[]) => {
    for (const b of list) {
      const url = b.props?.url;
      if (typeof url === "string" && url.startsWith(FILE_SCHEME)) files.add(url.slice(FILE_SCHEME.length));
      if (b.type === "flashcard") {
        const front = String(b.props?.front ?? "").trim();
        const back = String(b.props?.back ?? "").trim();
        if (front && back) cards.push({ id: b.id, front, back });
        lines.push(front, back);
      } else if (b.type === "pdf") {
        // Les passages surlignés d'un PDF sont retrouvables par la recherche.
        lines.push(String(b.props?.name ?? ""));
        try {
          for (const h of JSON.parse(String(b.props?.highlights ?? "[]"))) lines.push(String(h.text ?? ""));
        } catch {
          /* surlignages illisibles : ignorés pour l'index */
        }
      } else if (b.type === "mathBlock") {
        lines.push(String(b.props?.latex ?? ""));
      } else {
        lines.push(inlineText(b.content, links));
      }
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);

  return { body: lines.filter(Boolean).join("\n"), cards, links: [...links], files: [...files] };
}

/** Transforme une saisie libre en requête FTS5 sûre (recherche par préfixe). */
export function toFtsQuery(input: string): string {
  return input
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => `"${w}"*`)
    .join(" ");
}
