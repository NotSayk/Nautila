/**
 * Préparation de l'export Markdown (fonctions pures). La conversion elle-même reste celle de
 * l'éditeur (`blocksToMarkdownLossy`) : les blocs propres à Nautila sont d'abord ramenés à des
 * blocs standards, et les formules remplacées par des repères remis en `$…$` / `$$…$$` ensuite
 * (sans quoi la conversion échapperait leurs `\`, `_` et `*`).
 */
import { citeLabel } from "../data/refs";
import type { ExportBlock, ExportSources, Translate } from "./html";

type Inline = { type: string; text?: string; styles?: Record<string, unknown>; content?: unknown; props?: any };

const text = (value: string, styles: Record<string, unknown> = {}): Inline => ({ type: "text", text: value, styles });

export function markdownBlocks(
  blocks: ExportBlock[],
  sources: ExportSources,
  t: Translate,
): { blocks: ExportBlock[]; restore: (markdown: string) => string } {
  const formulas: string[] = [];
  const mark = (formula: string) => `NautilaFormula${formulas.push(formula) - 1}Z`;
  let equation = 1;

  const inline = (content: unknown): unknown => {
    if (!Array.isArray(content)) return content;
    return content.flatMap((item: Inline): Inline[] => {
      if (!item || typeof item !== "object") return [item];
      switch (item.type) {
        case "text":
          return [{ ...item, text: (item.text ?? "").replace(/￼/g, "") }];
        case "link":
          return [{ ...item, content: inline(item.content) }];
        case "math":
          return item.props?.latex ? [text(mark(`$${String(item.props.latex).trim()}$`))] : [];
        case "pageLink": {
          const page = sources.pages.get(String(item.props?.pageId ?? ""));
          return [text(page ? page.title || t("untitled") : t("exportMissingPage"))];
        }
        case "cite": {
          const key = String(item.props?.key ?? "");
          const ref = sources.refs.find((r) => r.key === key);
          return key ? [text(`(${ref ? citeLabel(ref) : key})`)] : [];
        }
        default:
          return [item];
      }
    });
  };

  const tableContent = (content: any) =>
    content?.type === "tableContent"
      ? {
          ...content,
          rows: (content.rows ?? []).map((row: any) => ({
            ...row,
            cells: (row.cells ?? []).map((cell: any) =>
              Array.isArray(cell) ? inline(cell) : { ...cell, content: inline(cell?.content) },
            ),
          })),
        }
      : inline(content);

  const cited = new Set<string>();
  const syncing = new Set<string>();

  const convert = (list: ExportBlock[]): ExportBlock[] =>
    list.flatMap((b): ExportBlock[] => {
      const kids = b.children?.length ? convert(b.children) : [];
      const scan = (content: unknown) =>
        Array.isArray(content) &&
        content.forEach((c: Inline) => c?.type === "cite" && c.props?.key && cited.add(String(c.props.key)));
      scan(b.content);
      switch (b.type) {
        case "mathBlock": {
          const latex = String(b.props?.latex ?? "").trim();
          if (!latex) return [];
          const tag = b.props?.numbered ? ` \\tag{${equation++}}` : "";
          return [{ id: b.id, type: "paragraph", content: [text(mark(`$$\n${latex}${tag}\n$$`))] }];
        }
        case "syncedBlock": {
          const id = String(b.props?.sourceId ?? "");
          if (syncing.has(id)) return [];
          syncing.add(id);
          const inner = convert(sources.synced.get(id) ?? []);
          syncing.delete(id);
          return inner;
        }
        case "flashcard":
          return [
            {
              id: b.id,
              type: "quote",
              content: [
                text(`${t("question")} :`, { bold: true }),
                text(` ${String(b.props?.front ?? "").trim()}\n`),
                text(`${t("answer")} :`, { bold: true }),
                text(` ${String(b.props?.back ?? "").trim()}`),
              ],
            },
          ];
        case "pdf": {
          let highlights: { text?: string; page?: number }[] = [];
          try {
            highlights = JSON.parse(String(b.props?.highlights ?? "[]"));
          } catch {
            /* surlignages illisibles */
          }
          return [
            { id: b.id, type: "paragraph", content: [text(String(b.props?.name || "PDF"), { bold: true })] },
            ...highlights
              .filter((h) => h.text?.trim())
              .map((h) => ({
                id: `${b.id}-${h.page}-${h.text!.length}`,
                type: "quote",
                content: [text(`${h.text!.trim()}${h.page ? ` (p. ${h.page})` : ""}`)],
              })),
          ];
        }
        case "databaseEmbed": {
          const base = sources.databases.get(String(b.props?.pageId ?? ""));
          if (!base) return [];
          const cell = (value: string) => [text(value)];
          const valueText = (propId: string, row: (typeof base.rows)[number]) => {
            const prop = base.props.find((p) => p.id === propId)!;
            const value = row.props[propId];
            if (value == null || value === "") return "";
            if (prop.type === "checkbox") return value === true ? "✓" : "";
            const list = Array.isArray(value) ? value : [value];
            if (prop.type === "select" || prop.type === "multi_select")
              return list.map((id) => prop.options?.find((o) => o.id === id)?.name ?? String(id)).join(", ");
            if (prop.type === "relation")
              return list.map((id) => sources.pages.get(String(id))?.title ?? "").join(", ");
            return list.map(String).join(", ");
          };
          return [
            { id: `${b.id}-title`, type: "paragraph", content: [text(base.title || t("untitled"), { bold: true })] },
            {
              id: b.id,
              type: "table",
              content: {
                type: "tableContent",
                headerRows: 1,
                rows: [
                  { cells: [cell(t("name")), ...base.props.map((p) => cell(p.name))] },
                  ...base.rows.map((r) => ({
                    cells: [cell(r.title || t("untitled")), ...base.props.map((p) => cell(valueText(p.id, r)))],
                  })),
                ],
              },
            },
          ];
        }
        case "bibliography":
          return [{ id: b.id, type: "bibliography" }];
        case "toc":
        case "sketch":
        case "audioNote":
          return [];
        case "table":
          return [{ ...b, content: tableContent(b.content), children: kids }];
        default: {
          const content = inline(b.content);
          // Élément de liste vide : il donnerait une puce seule.
          const empty =
            Array.isArray(content) && !content.some((c: Inline) => c?.type !== "text" || (c.text ?? "").trim() !== "");
          if (empty && kids.length === 0 && /ListItem$/.test(b.type)) return [];
          return [{ ...b, content, children: kids }];
        }
      }
    });

  const converted = convert(blocks);
  // La bibliographie dépend de toutes les citations de la page : elle est remplie à la fin.
  const bibliography = sources.refs
    .filter((r) => cited.has(r.key))
    .map((r): ExportBlock => ({
      id: `bib-${r.key}`,
      type: "paragraph",
      content: [
        text(`${r.author || r.key}${r.year ? ` (${r.year})` : ""}. `),
        ...(r.title ? [text(r.title, { italic: true }), text(".")] : []),
      ],
    }));
  const withBibliography = (list: ExportBlock[]): ExportBlock[] =>
    list.flatMap((b) =>
      b.type === "bibliography" ? bibliography : [{ ...b, children: b.children && withBibliography(b.children) }],
    );

  return {
    blocks: withBibliography(converted),
    restore: (markdown) =>
      markdown.replace(/￼/g, "").replace(/NautilaFormula(\d+)Z/g, (_, n: string) => formulas[Number(n)] ?? ""),
  };
}
