/**
 * Export d'une page en document HTML autonome (fonctions pures).
 * Tout ce qui vient de la base (fichiers, pages liées, références, blocs synchronisés,
 * bases intégrées, code coloré) est préparé en amont et passé dans `ExportSources`.
 */
import katex from "katex";
import type { CodeToken } from "../editor/highlight";
import type { Prop, Row, Value } from "../data/dbquery";
import type { PageFont } from "../data/pages";
import { citeLabel, type Reference } from "../data/refs";
import type { Key, Lang } from "../i18n";

export type ExportBlock = {
  id: string;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props?: Record<string, any>;
  content?: unknown;
  children?: ExportBlock[];
};
/** Fichier joint : contenu en base64. */
export type ExportFile = { name: string; mime: string; data: string };
export type ExportDatabase = { title: string; icon: string | null; props: Prop[]; rows: Row[] };
export type ExportSources = {
  /** Par adresse (`nautila-file:…`). */
  files: Map<string, ExportFile>;
  pages: Map<string, { title: string; icon: string | null }>;
  /** Bibliothèque, dans l'ordre d'affichage de la bibliographie. */
  refs: Reference[];
  /** Contenu des blocs synchronisés, par page source. */
  synced: Map<string, ExportBlock[]>;
  /** Bases intégrées, lignes déjà filtrées et triées. */
  databases: Map<string, ExportDatabase>;
  /** Code coloré, par `codeKey(langage, code)`. */
  code: Map<string, CodeToken[][]>;
};
export type ExportPage = {
  title: string;
  icon: string | null;
  tags: string[];
  font: PageFont;
  small: boolean;
  wide: boolean;
  /** `color:#…`, adresse d'un fichier ou URL d'image. */
  cover: string | null;
};
export type Translate = (key: Key) => string;

export const emptySources = (): ExportSources => ({
  files: new Map(),
  pages: new Map(),
  refs: [],
  synced: new Map(),
  databases: new Map(),
  code: new Map(),
});

/** Au-delà, un fichier joint (hors image et audio) n'est pas intégré au document. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = new Set(["image", "video", "audio", "file", "audioNote", "pdf"]);

export const codeKey = (language: string, code: string) => `${language}\n${code}`;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Échappe un texte pour le HTML ; retire le caractère de remplacement d'objet (U+FFFC). */
export const escapeHtml = (text: string) => text.replace(/￼/g, "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

// Couleurs de BlockNote (thème clair).
const COLORS: Record<string, { text: string; background: string }> = {
  gray: { text: "#9b9a97", background: "#ebeced" },
  brown: { text: "#64473a", background: "#e9e5e3" },
  red: { text: "#e03e3e", background: "#fbe4e4" },
  orange: { text: "#d9730d", background: "#f6e9d9" },
  yellow: { text: "#dfab01", background: "#fbf3db" },
  green: { text: "#4d6461", background: "#ddedea" },
  blue: { text: "#0b6e99", background: "#ddebf1" },
  purple: { text: "#6940a5", background: "#eae4f2" },
  pink: { text: "#ad1a72", background: "#f4dfeb" },
};
const HEX = /^#[0-9a-f]{3,8}$/i;
const color = (value: unknown, kind: "text" | "background") =>
  typeof value !== "string" || value === "default" ? null : (COLORS[value]?.[kind] ?? (HEX.test(value) ? value : null));

function styleAttr(rules: (string | number | null | false | undefined)[]): string {
  const kept = rules.filter(Boolean);
  return kept.length ? ` style="${escapeHtml(kept.join(";"))}"` : "";
}

function blockStyle(props: Record<string, unknown> = {}) {
  const text = color(props.textColor, "text");
  const bg = color(props.backgroundColor, "background");
  const align = props.textAlignment;
  return [
    text && `color:${text}`,
    bg && `background:${bg}`,
    bg && "padding:2px 4px;border-radius:3px",
    typeof align === "string" && /^(center|right|justify)$/.test(align) && `text-align:${align}`,
  ];
}

const safeHref = (href: unknown) =>
  typeof href === "string" && /^(https?:|mailto:|tel:|#)/i.test(href.trim()) ? href.trim() : null;

const latex = (source: string, displayMode: boolean) =>
  katex.renderToString(source, { output: "mathml", displayMode, throwOnError: false });

type Ctx = {
  sources: ExportSources;
  t: Translate;
  /** Numéro de la prochaine équation numérotée. */
  equation: number;
  /** Blocs synchronisés en cours de rendu (garde contre un contenu qui s'inclurait lui-même). */
  syncing: Set<string>;
  headings: Heading[];
  cited: Reference[];
};

// ---------- Contenu en ligne ----------
type Styles = Record<string, unknown>;

function styledText(text: string, styles: Styles = {}): string {
  let html = escapeHtml(text).replace(/\n/g, "<br>");
  if (!html) return "";
  if (styles.code) html = `<code>${html}</code>`;
  if (styles.bold) html = `<strong>${html}</strong>`;
  if (styles.italic) html = `<em>${html}</em>`;
  if (styles.underline) html = `<u>${html}</u>`;
  if (styles.strike) html = `<s>${html}</s>`;
  const text_ = color(styles.textColor, "text");
  const bg = color(styles.backgroundColor, "background");
  if (text_ || bg) html = `<span${styleAttr([text_ && `color:${text_}`, bg && `background:${bg}`])}>${html}</span>`;
  return html;
}

function pageTitle(id: string, ctx: Ctx) {
  const page = ctx.sources.pages.get(id);
  return page ? { icon: page.icon, title: page.title || ctx.t("untitled") } : null;
}

function inline(content: unknown, ctx: Ctx): string {
  if (typeof content === "string") return styledText(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return styledText(item);
      if (!item || typeof item !== "object") return "";
      const node = item as {
        type?: string;
        text?: string;
        styles?: Styles;
        href?: string;
        content?: unknown;
        props?: any;
      };
      switch (node.type) {
        case "text":
          return styledText(node.text ?? "", node.styles);
        case "link": {
          const inner = inline(node.content, ctx);
          const href = safeHref(node.href);
          return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
        }
        case "math":
          return node.props?.latex ? latex(String(node.props.latex), false) : "";
        case "pageLink": {
          const page = pageTitle(String(node.props?.pageId ?? ""), ctx);
          return page
            ? `<span class="page-ref">${page.icon ? `${escapeHtml(page.icon)} ` : ""}${escapeHtml(page.title)}</span>`
            : `<span class="page-ref missing">${escapeHtml(ctx.t("exportMissingPage"))}</span>`;
        }
        case "cite": {
          const key = String(node.props?.key ?? "");
          if (!key) return "";
          const ref = ctx.sources.refs.find((r) => r.key === key);
          const title = ref ? [ref.author, ref.title].filter(Boolean).join(" — ") : "";
          return `<span class="cite"${title ? ` title="${escapeHtml(title)}"` : ""}>(${escapeHtml(ref ? citeLabel(ref) : key)})</span>`;
        }
        default:
          return Array.isArray(node.content) ? inline(node.content, ctx) : "";
      }
    })
    .join("");
}

/** Texte brut d'un contenu en ligne (titres du sommaire). */
function plainText(content: unknown, sources: ExportSources): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      const node = item as { type?: string; text?: string; content?: unknown; props?: any };
      if (node?.type === "text") return node.text ?? "";
      if (node?.type === "link") return plainText(node.content, sources);
      if (node?.type === "pageLink") return sources.pages.get(String(node.props?.pageId))?.title ?? "";
      if (node?.type === "math") return node.props?.latex ?? "";
      return "";
    })
    .join("")
    .replace(/￼/g, "");
}

const hasContent = (content: unknown): boolean =>
  typeof content === "string"
    ? content.replace(/￼/g, "").trim() !== ""
    : Array.isArray(content) &&
      content.some((c): boolean =>
        typeof c === "string"
          ? c.replace(/￼/g, "").trim() !== ""
          : c?.type === "text"
            ? (c.text ?? "").replace(/￼/g, "").trim() !== ""
            : c?.type === "link"
              ? hasContent(c.content)
              : c?.type === "cite"
                ? !!c.props?.key
                : c?.type === "math"
                  ? !!c.props?.latex
                  : true,
      );

// ---------- Parcours du document ----------
type Heading = { id: string; level: number; text: string };

export const anchorId = (blockId: string) => `h-${blockId.replace(/[^\w-]/g, "")}`;

/** Parcourt les blocs, y compris le contenu des blocs synchronisés (une seule fois chacun). */
function walk(
  blocks: ExportBlock[],
  sources: ExportSources,
  visit: (b: ExportBlock) => void,
  seen = new Set<string>(),
) {
  for (const b of blocks) {
    visit(b);
    if (b.children?.length) walk(b.children, sources, visit, seen);
    const source = b.type === "syncedBlock" ? String(b.props?.sourceId ?? "") : "";
    if (source && !seen.has(source)) {
      seen.add(source);
      walk(sources.synced.get(source) ?? [], sources, visit, seen);
    }
  }
}

export type ExportNeeds = {
  files: Set<string>;
  synced: Set<string>;
  databases: Set<string>;
  code: { language: string; code: string }[];
};

/** Ce qu'il faut lire en base pour exporter ces blocs (y compris dans les blocs synchronisés déjà connus). */
export function collectNeeds(blocks: ExportBlock[], sources: ExportSources = emptySources()): ExportNeeds {
  const needs: ExportNeeds = { files: new Set(), synced: new Set(), databases: new Set(), code: [] };
  walk(blocks, sources, (b) => {
    const url = b.props?.url;
    if (FILE_TYPES.has(b.type) && typeof url === "string" && url) needs.files.add(url);
    if (b.type === "syncedBlock" && b.props?.sourceId) needs.synced.add(String(b.props.sourceId));
    if (b.type === "databaseEmbed" && b.props?.pageId) needs.databases.add(String(b.props.pageId));
    if (b.type === "codeBlock") {
      const code = codeText(b);
      const language = String(b.props?.language ?? "text");
      if (code && language !== "text") needs.code.push({ language, code });
    }
  });
  return needs;
}

function collectHeadings(blocks: ExportBlock[], sources: ExportSources): Heading[] {
  const out: Heading[] = [];
  walk(blocks, sources, (b) => {
    if (b.type !== "heading") return;
    const text = plainText(b.content, sources).trim();
    if (text) out.push({ id: b.id, level: Number(b.props?.level) || 1, text });
  });
  return out;
}

function citedRefs(blocks: ExportBlock[], sources: ExportSources): Reference[] {
  const keys = new Set<string>();
  const scan = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const c of content) {
      if (c?.type === "cite" && c.props?.key) keys.add(String(c.props.key));
      else if (c?.type === "link") scan(c.content);
    }
  };
  walk(blocks, sources, (b) => {
    scan(b.content);
    const table = b.content as { type?: string; rows?: { cells?: unknown[] }[] } | undefined;
    if (table?.type === "tableContent")
      for (const row of table.rows ?? [])
        for (const cell of row.cells ?? []) scan(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content);
  });
  return sources.refs.filter((r) => keys.has(r.key));
}

// ---------- Blocs ----------
const isFile = (b: ExportBlock, sources: ExportSources) => sources.files.get(String(b.props?.url ?? ""));
const dataUrl = (file: ExportFile) => `data:${file.mime || "application/octet-stream"};base64,${file.data}`;
const byteSize = (file: ExportFile) => Math.floor((file.data.length * 3) / 4);
/** Adresse affichable hors de l'application : fichier intégré, ou URL externe d'origine. */
function mediaUrl(b: ExportBlock, sources: ExportSources): string | null {
  const file = isFile(b, sources);
  if (file) return dataUrl(file);
  const url = String(b.props?.url ?? "");
  return /^(https?:|data:)/i.test(url) ? url : null;
}

function children(b: ExportBlock, ctx: Ctx, cls = "children") {
  const inner = b.children?.length ? renderBlocks(b.children, ctx) : "";
  return inner ? `<div class="${cls}">${inner}</div>` : "";
}

const codeText = (b: ExportBlock) => plainText(b.content, emptySources());

function renderCode(b: ExportBlock, ctx: Ctx): string {
  const code = codeText(b);
  if (!code.trim()) return "";
  const language = String(b.props?.language ?? "text");
  const tokens = ctx.sources.code.get(codeKey(language, code));
  const body = tokens
    ? tokens
        .map((line) =>
          line
            .map((tok) => {
              const style = [
                tok.color && HEX.test(tok.color) && `color:${tok.color}`,
                (tok.fontStyle ?? 0) & 1 && "font-style:italic",
                (tok.fontStyle ?? 0) & 2 && "font-weight:600",
                (tok.fontStyle ?? 0) & 4 && "text-decoration:underline",
              ];
              const text = escapeHtml(tok.content);
              return style.some(Boolean) ? `<span${styleAttr(style)}>${text}</span>` : text;
            })
            .join(""),
        )
        .join("\n")
    : escapeHtml(code);
  return `<pre class="code" data-language="${escapeHtml(language)}"><code>${body}</code></pre>`;
}

type Cell = { type?: string; content?: unknown; props?: Record<string, unknown> };

function renderTable(b: ExportBlock, ctx: Ctx): string {
  const table = b.content as
    | { rows?: { cells?: (Cell | unknown[])[] }[]; headerRows?: number; headerCols?: number; columnWidths?: unknown[] }
    | undefined;
  const rows = table?.rows ?? [];
  if (rows.length === 0) return "";
  const headerRows = Number(table?.headerRows) || 0;
  const headerCols = Number(table?.headerCols) || 0;
  const widths = table?.columnWidths ?? [];
  const cols = widths.some((w) => typeof w === "number")
    ? `<colgroup>${widths.map((w) => `<col${typeof w === "number" ? ` style="width:${Math.round(w)}px"` : ""}>`).join("")}</colgroup>`
    : "";
  const row = (cells: (Cell | unknown[])[], header: boolean) =>
    `<tr>${cells
      .map((cell, i) => {
        const c: Cell = Array.isArray(cell) ? { content: cell } : (cell as Cell);
        const tag = header || i < headerCols ? "th" : "td";
        const span = [
          Number(c.props?.colspan) > 1 ? ` colspan="${Number(c.props?.colspan)}"` : "",
          Number(c.props?.rowspan) > 1 ? ` rowspan="${Number(c.props?.rowspan)}"` : "",
        ].join("");
        return `<${tag}${span}${styleAttr(blockStyle(c.props))}>${inline(c.content, ctx)}</${tag}>`;
      })
      .join("")}</tr>`;
  const head = rows.slice(0, headerRows).map((r) => row(r.cells ?? [], true));
  const body = rows.slice(headerRows).map((r) => row(r.cells ?? [], false));
  return `<div class="table"><table>${cols}${head.length ? `<thead>${head.join("")}</thead>` : ""}<tbody>${body.join("")}</tbody></table></div>`;
}

function caption(b: ExportBlock) {
  const text = String(b.props?.caption ?? "").trim();
  return text ? `<figcaption>${escapeHtml(text)}</figcaption>` : "";
}

function renderImage(b: ExportBlock, ctx: Ctx): string {
  const src = mediaUrl(b, ctx.sources);
  if (!src) return "";
  const width = Number(b.props?.previewWidth);
  const align = b.props?.textAlignment;
  const name = String(b.props?.name ?? "");
  return `<figure class="image${align === "center" ? " center" : align === "right" ? " right" : ""}"><img src="${escapeHtml(src)}" alt="${escapeHtml(String(b.props?.caption || name))}"${width > 0 ? ` style="width:${Math.round(width)}px"` : ""}>${caption(b)}</figure>`;
}

/** Audio ou vidéo : le lecteur à l'écran, le nom du fichier à l'impression. */
function renderPlayer(b: ExportBlock, ctx: Ctx, tag: "audio" | "video", label: string): string {
  const file = isFile(b, ctx.sources);
  const url = String(b.props?.url ?? "");
  if (!url) return "";
  const name = String(b.props?.name || file?.name || label);
  const src = file
    ? tag === "audio" || byteSize(file) <= MAX_ATTACHMENT_BYTES * 4
      ? dataUrl(file)
      : null
    : mediaUrl(b, ctx.sources);
  const icon = tag === "audio" ? "🔊" : "🎬";
  const player = src ? `<${tag} controls preload="metadata" src="${escapeHtml(src)}"></${tag}>` : "";
  return `<figure class="media">${player}<div class="attachment-name${player ? " print-only" : ""}">${icon} ${escapeHtml(name)}</div>${caption(b)}</figure>`;
}

function attachmentLink(file: ExportFile | undefined, name: string, ctx: Ctx) {
  if (!file) return "";
  if (byteSize(file) > MAX_ATTACHMENT_BYTES) return `<span class="muted">${escapeHtml(ctx.t("exportTooLarge"))}</span>`;
  return `<a class="download" href="${escapeHtml(dataUrl(file))}" download="${escapeHtml(name)}">${escapeHtml(ctx.t("exportDownload"))}</a>`;
}

function renderFile(b: ExportBlock, ctx: Ctx): string {
  const url = String(b.props?.url ?? "");
  if (!url) return "";
  const file = isFile(b, ctx.sources);
  const name = String(b.props?.name || file?.name || url.split("/").pop() || "");
  const external = !file && safeHref(url);
  const link = external
    ? `<a class="download" href="${escapeHtml(external)}">${escapeHtml(ctx.t("exportDownload"))}</a>`
    : attachmentLink(file, name, ctx);
  return `<div class="attachment"><div class="attachment-name">📎 ${escapeHtml(name)}${link ? ` ${link}` : ""}</div>${caption(b)}</div>`;
}

type Highlight = { id?: string; page?: number; text?: string };

function renderPdf(b: ExportBlock, ctx: Ctx): string {
  const url = String(b.props?.url ?? "");
  if (!url) return "";
  const file = isFile(b, ctx.sources);
  const name = String(b.props?.name || file?.name || "PDF");
  let highlights: Highlight[] = [];
  try {
    const parsed = JSON.parse(String(b.props?.highlights ?? "[]"));
    if (Array.isArray(parsed)) highlights = parsed;
  } catch {
    /* surlignages illisibles : seul le nom est exporté */
  }
  const quotes = highlights
    .filter((h) => h.text?.trim())
    .sort((a, c) => (a.page ?? 0) - (c.page ?? 0))
    .map(
      (h) =>
        `<blockquote class="pdf-quote">${escapeHtml(h.text!.trim())}${h.page ? ` <span class="pdf-page">p. ${Number(h.page)}</span>` : ""}</blockquote>`,
    )
    .join("");
  const link = attachmentLink(file, name, ctx);
  return `<div class="attachment"><div class="attachment-name">📄 ${escapeHtml(name)}${link ? ` ${link}` : ""}</div>${quotes}</div>`;
}

type Stroke = { d?: string; color?: string };
const SKETCH = { w: 800, h: 360 };

function renderSketch(b: ExportBlock): string {
  let strokes: Stroke[] = [];
  try {
    const parsed = JSON.parse(String(b.props?.strokes ?? "[]"));
    if (Array.isArray(parsed)) strokes = parsed;
  } catch {
    return "";
  }
  const paths = strokes
    .filter((s) => typeof s.d === "string" && /^[MLmlCcQqZz0-9.,\s-]+$/.test(s.d))
    .map((s) => {
      const ink = s.color && HEX.test(s.color) ? s.color : "#000000";
      return `<path d="${s.d}" stroke="${ink}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    });
  if (paths.length === 0) return "";
  return `<figure class="sketch"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SKETCH.w} ${SKETCH.h}" width="${SKETCH.w}" height="${SKETCH.h}">${paths.join("")}</svg></figure>`;
}

const OPTION_COLORS = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);

function dbValue(prop: Prop, value: Value, ctx: Ctx): string {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return "";
  switch (prop.type) {
    case "checkbox":
      return `<span class="check${value === true ? " on" : ""}">${value === true ? "✓" : ""}</span>`;
    case "select":
    case "multi_select":
      return (Array.isArray(value) ? value : [String(value)])
        .map((id) => {
          const option = prop.options?.find((o) => o.id === id);
          const tone = option && OPTION_COLORS.has(option.color) ? option.color : "gray";
          return `<span class="tag tag-${tone}">${escapeHtml(option?.name ?? String(id))}</span>`;
        })
        .join(" ");
    case "relation":
      return (Array.isArray(value) ? value : [String(value)])
        .map((id) => escapeHtml(pageTitle(String(id), ctx)?.title ?? ""))
        .filter(Boolean)
        .join(", ");
    case "url": {
      const href = safeHref(value);
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(String(value))}</a>` : escapeHtml(String(value));
    }
    default:
      return escapeHtml(Array.isArray(value) ? value.join(", ") : String(value));
  }
}

function renderDatabase(b: ExportBlock, ctx: Ctx): string {
  const id = String(b.props?.pageId ?? "");
  const base = ctx.sources.databases.get(id);
  if (!base) return "";
  const title = `<div class="db-title">${base.icon ? `${escapeHtml(base.icon)} ` : ""}${escapeHtml(base.title || ctx.t("untitled"))}</div>`;
  const head = `<tr><th>${escapeHtml(ctx.t("name"))}</th>${base.props.map((p) => `<th>${escapeHtml(p.name)}</th>`).join("")}</tr>`;
  const rows = base.rows
    .map(
      (r) =>
        `<tr><td>${r.icon ? `${escapeHtml(r.icon)} ` : ""}${escapeHtml(r.title || ctx.t("untitled"))}</td>${base.props
          .map((p) => `<td>${dbValue(p, r.props[p.id], ctx)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="database">${title}<div class="table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderToc(ctx: Ctx): string {
  if (ctx.headings.length === 0) return "";
  const top = Math.min(...ctx.headings.map((h) => h.level));
  const links = ctx.headings
    .map(
      (h) => `<a href="#${anchorId(h.id)}" style="padding-left:${(h.level - top) * 1.4}em">${escapeHtml(h.text)}</a>`,
    )
    .join("");
  return `<nav class="toc" aria-label="${escapeHtml(ctx.t("toc"))}">${links}</nav>`;
}

function renderBibliography(ctx: Ctx): string {
  if (ctx.cited.length === 0) return "";
  const items = ctx.cited
    .map(
      (r) =>
        `<p>${escapeHtml(r.author || r.key)}${r.year ? ` (${escapeHtml(r.year)})` : ""}.${r.title ? ` <em>${escapeHtml(r.title)}</em>.` : ""}</p>`,
    )
    .join("");
  return `<div class="bibliography">${items}</div>`;
}

function renderFlashcard(b: ExportBlock, ctx: Ctx): string {
  const front = String(b.props?.front ?? "").trim();
  const back = String(b.props?.back ?? "").trim();
  if (!front && !back) return "";
  const side = (label: string, text: string) =>
    `<div><span class="fc-label">${escapeHtml(label)}</span><div>${escapeHtml(text).replace(/\n/g, "<br>")}</div></div>`;
  return `<div class="flashcard">${side(ctx.t("question"), front)}${side(ctx.t("answer"), back)}</div>`;
}

function renderMath(b: ExportBlock, ctx: Ctx): string {
  const source = String(b.props?.latex ?? "").trim();
  if (!source) return "";
  const number = b.props?.numbered ? `<span class="eq-number">(${ctx.equation++})</span>` : "";
  return `<div class="math-block">${latex(source, true)}${number}</div>`;
}

function renderSynced(b: ExportBlock, ctx: Ctx): string {
  const id = String(b.props?.sourceId ?? "");
  const content = ctx.sources.synced.get(id);
  if (!content || ctx.syncing.has(id)) return "";
  ctx.syncing.add(id);
  const html = renderBlocks(content, ctx);
  ctx.syncing.delete(id);
  return html ? `<div class="synced">${html}</div>` : "";
}

function renderHeading(b: ExportBlock, ctx: Ctx): string {
  const level = Math.min(Math.max(Number(b.props?.level) || 1, 1), 6);
  if (!hasContent(b.content) && !b.children?.length) return "";
  // Le titre de la page est le seul <h1> : les titres du contenu commencent à <h2>.
  const tag = `h${Math.min(level + 1, 6)}`;
  const heading = `<${tag} id="${anchorId(b.id)}" class="h${level}"${styleAttr(blockStyle(b.props))}>${inline(b.content, ctx)}</${tag}>`;
  if (b.props?.isToggleable)
    return `<details open class="toggle"><summary>${heading}</summary>${children(b, ctx, "toggle-body")}</details>`;
  return heading + children(b, ctx);
}

function renderBlock(b: ExportBlock, ctx: Ctx): string {
  const style = styleAttr(blockStyle(b.props));
  switch (b.type) {
    case "paragraph":
      return (hasContent(b.content) ? `<p${style}>${inline(b.content, ctx)}</p>` : "") + children(b, ctx);
    case "heading":
      return renderHeading(b, ctx);
    case "quote":
      return hasContent(b.content) || b.children?.length
        ? `<blockquote${style}>${hasContent(b.content) ? `<p>${inline(b.content, ctx)}</p>` : ""}${children(b, ctx, "quote-children")}</blockquote>`
        : "";
    case "toggleListItem":
      return hasContent(b.content) || b.children?.length
        ? `<details open class="toggle"><summary${style}>${inline(b.content, ctx)}</summary>${children(b, ctx, "toggle-body")}</details>`
        : "";
    case "codeBlock":
      return renderCode(b, ctx);
    case "table":
      return renderTable(b, ctx);
    case "image":
      return renderImage(b, ctx);
    case "video":
      return renderPlayer(b, ctx, "video", "Video");
    case "audio":
      return renderPlayer(b, ctx, "audio", ctx.t("audioNote"));
    case "audioNote":
      return renderPlayer({ ...b, props: { ...b.props, name: ctx.t("audioNote") } }, ctx, "audio", ctx.t("audioNote"));
    case "file":
      return renderFile(b, ctx);
    case "pdf":
      return renderPdf(b, ctx);
    case "sketch":
      return renderSketch(b);
    case "divider":
      return "<hr>";
    case "pageBreak":
      return `<div class="page-break"></div>`;
    case "columnList": {
      const cols = (b.children ?? [])
        .map((col) => {
          const inner = renderBlocks(col.children ?? [], ctx);
          const width = Number(col.props?.width) > 0 ? Number(col.props?.width) : 1;
          return inner ? `<div class="column" style="flex:${width} 1 0">${inner}</div>` : "";
        })
        .filter(Boolean);
      return cols.length ? `<div class="columns">${cols.join("")}</div>` : "";
    }
    case "column":
      return renderBlocks(b.children ?? [], ctx);
    case "mathBlock":
      return renderMath(b, ctx);
    case "flashcard":
      return renderFlashcard(b, ctx);
    case "callout": {
      const body =
        (hasContent(b.content) ? `<p>${inline(b.content, ctx)}</p>` : "") + renderBlocks(b.children ?? [], ctx);
      if (!body) return "";
      const icon = String(b.props?.icon ?? "");
      return `<div class="callout"${style}>${icon ? `<span class="callout-icon">${escapeHtml(icon)}</span>` : ""}<div class="callout-body">${body}</div></div>`;
    }
    case "toc":
      return renderToc(ctx);
    case "bibliography":
      return renderBibliography(ctx);
    case "databaseEmbed":
      return renderDatabase(b, ctx);
    case "syncedBlock":
      return renderSynced(b, ctx);
    default:
      return (hasContent(b.content) ? `<p${style}>${inline(b.content, ctx)}</p>` : "") + children(b, ctx);
  }
}

const LISTS: Record<string, "ul" | "ol"> = { bulletListItem: "ul", numberedListItem: "ol", checkListItem: "ul" };

function renderList(type: string, items: ExportBlock[], ctx: Ctx): string {
  const html = items
    .map((b) => {
      const text = hasContent(b.content) ? inline(b.content, ctx) : "";
      const kids = b.children?.length ? renderBlocks(b.children, ctx) : "";
      if (!text && !kids) return "";
      const style = styleAttr(blockStyle(b.props));
      if (type !== "checkListItem") return `<li${style}>${text}${kids}</li>`;
      const done = !!b.props?.checked;
      return `<li class="${done ? "done" : ""}"${style}><span class="check${done ? " on" : ""}">${done ? "✓" : ""}</span><div><span class="item">${text}</span>${kids}</div></li>`;
    })
    .filter(Boolean);
  if (html.length === 0) return "";
  const tag = LISTS[type];
  const start = Number(items[0].props?.start);
  const attrs = type === "checkListItem" ? ` class="checklist"` : tag === "ol" && start > 1 ? ` start="${start}"` : "";
  return `<${tag}${attrs}>${html.join("")}</${tag}>`;
}

function renderBlocks(list: ExportBlock[], ctx: Ctx): string {
  let out = "";
  for (let i = 0; i < list.length;) {
    const type = list[i].type;
    if (LISTS[type]) {
      const group: ExportBlock[] = [];
      while (i < list.length && list[i].type === type) group.push(list[i++]);
      out += renderList(type, group, ctx);
    } else out += renderBlock(list[i++], ctx);
  }
  return out;
}

/** Contenu de la page seul (sans en-tête ni styles). */
export function renderBlocksHtml(blocks: ExportBlock[], sources: ExportSources, t: Translate): string {
  const ctx: Ctx = {
    sources,
    t,
    equation: 1,
    syncing: new Set(),
    headings: collectHeadings(blocks, sources),
    cited: citedRefs(blocks, sources),
  };
  return renderBlocks(blocks, ctx);
}

const FONTS: Record<PageFont, string> = {
  sans: `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"`,
  serif: `Lyon-Text, Georgia, "Times New Roman", serif, "Apple Color Emoji", "Segoe UI Emoji"`,
  mono: `iawriter-mono, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`,
};

function renderCover(cover: string | null, sources: ExportSources): string {
  if (!cover) return "";
  if (cover.startsWith("color:")) {
    const value = cover.slice(6);
    return HEX.test(value) ? `<div class="cover" style="background:${value}"></div>` : "";
  }
  const file = sources.files.get(cover);
  const src = file ? dataUrl(file) : /^https?:/i.test(cover) ? cover : null;
  return src ? `<div class="cover"><img src="${escapeHtml(src)}" alt=""></div>` : "";
}

/** Document HTML complet et autonome : styles intégrés, fichiers en `data:`, toujours en thème clair. */
export function renderPageHtml(
  page: ExportPage,
  blocks: ExportBlock[],
  sources: ExportSources,
  t: Translate,
  lang: Lang,
): string {
  const title = page.title.trim() || t("untitled");
  const cover = renderCover(page.cover, sources);
  const tags = page.tags.length
    ? `<div class="tags">${page.tags.map((tag) => `<span class="tag tag-gray">#${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const classes = ["page", page.small && "small", page.wide && "wide", cover && "has-cover"].filter(Boolean).join(" ");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Nautila">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
${cover}<main class="${classes}" style="font-family:${escapeHtml(FONTS[page.font] ?? FONTS.sans)}">
<header>${page.icon ? `<div class="page-icon">${escapeHtml(page.icon)}</div>` : ""}<h1 class="title">${escapeHtml(title)}</h1>${tags}</header>
${renderBlocksHtml(blocks, sources, t)}
</main>
</body>
</html>
`;
}

const MONO = `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`;

/** Styles du document exporté : tout est rattaché à `.page`, pour fonctionner aussi dans une racine fantôme. */
export const EXPORT_CSS = `
:root { color-scheme: light; }
html, body { margin: 0; background: #fff; }
.page { box-sizing: border-box; max-width: 780px; margin: 0 auto; padding: 56px 32px 96px; background: #fff;
  color: #37352f; font-size: 16px; line-height: 1.6; overflow-wrap: break-word; -webkit-text-size-adjust: 100%; }
.page.small { font-size: 14px; }
.page.wide { max-width: 1120px; }
.page *, .page *::before, .page *::after { box-sizing: border-box; }
.cover { height: 220px; background: #f7f7f5; overflow: hidden; }
.cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
.page-icon { font-size: 64px; line-height: 1.1; margin-bottom: 8px; }
.has-cover .page-icon { margin-top: -96px; }
.page h1.title { margin: 0 0 6px; font-size: 2.5em; line-height: 1.2; font-weight: 700; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.page header { margin-bottom: 28px; }
.page p { margin: 0.25em 0; }
.page h2, .page h3, .page h4, .page h5, .page h6 { margin: 1.4em 0 0.35em; line-height: 1.3; font-weight: 600; }
.page .h1 { font-size: 1.875em; }
.page .h2 { font-size: 1.5em; }
.page .h3 { font-size: 1.25em; }
.page .h4 { font-size: 1.1em; }
.page .h5, .page .h6 { font-size: 1em; }
.page a { color: #0b6bcb; text-underline-offset: 2px; }
.page strong { font-weight: 600; }
.page ul, .page ol { margin: 0.25em 0; padding-left: 1.6em; }
.page li { margin: 0.15em 0; padding-left: 0.15em; }
.page li > ul, .page li > ol { margin: 0.1em 0; }
.page ul ul { list-style-type: circle; }
.page ul ul ul { list-style-type: square; }
.page ol ol { list-style-type: lower-alpha; }
.page ol ol ol { list-style-type: lower-roman; }
.page ul.checklist { list-style: none; padding-left: 0.1em; }
.checklist li { display: flex; align-items: flex-start; gap: 0.55em; padding-left: 0; }
.checklist li > div { min-width: 0; flex: 1; }
.checklist li.done > div > .item { color: #9b9a97; text-decoration: line-through; }
.check { display: inline-grid; place-items: center; flex: none; width: 1em; height: 1em; margin-top: 0.3em;
  border: 1.5px solid #5f5e5b; border-radius: 3px; color: #fff; font-size: 0.95em; line-height: 1; font-weight: 700; }
.check.on { background: #2383e2; border-color: #2383e2; }
.database .check { margin-top: 0; vertical-align: -0.15em; }
.children, .toggle-body { padding-left: 1.5em; }
.page blockquote { margin: 0.5em 0; padding: 0.1em 0 0.1em 14px; border-left: 3px solid #37352f; }
.quote-children { padding-left: 0.5em; }
.page hr { margin: 1.4em 0; border: 0; border-top: 1px solid #e3e2df; }
.page code { padding: 0.15em 0.35em; border-radius: 4px; background: rgba(135, 131, 120, 0.15); color: #c4372f;
  font-family: ${MONO}; font-size: 0.86em; }
.page pre.code { margin: 0.6em 0; padding: 16px 18px; border-radius: 6px; background: #f7f7f5; color: #24292e;
  font-family: ${MONO}; font-size: 0.85em; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.page pre.code code { padding: 0; background: none; color: inherit; font-size: inherit; }
.page .table { margin: 0.6em 0; overflow-x: auto; }
.page table { border-collapse: collapse; font-size: 0.94em; }
.page th, .page td { min-width: 60px; padding: 6px 10px; border: 1px solid #dcdcd8; text-align: left; vertical-align: top; }
.page th { background: #f7f7f5; font-weight: 600; }
.page td > p, .page th > p { margin: 0; }
.callout { display: flex; gap: 10px; margin: 0.5em 0; padding: 14px 16px 14px 12px; border-radius: 6px; background: #f1f1ef; }
.callout-icon { flex: none; width: 1.6em; font-size: 1.2em; line-height: 1.35; text-align: center; }
.callout-body { flex: 1; min-width: 0; }
.callout-body > :first-child { margin-top: 0; }
.callout-body > :last-child { margin-bottom: 0; }
.columns { display: flex; gap: 28px; margin: 0.3em 0; }
.column { min-width: 0; }
.column > :first-child { margin-top: 0; }
details.toggle { margin: 0.2em 0; }
details.toggle > summary { cursor: pointer; }
details.toggle > summary > h2, details.toggle > summary > h3, details.toggle > summary > h4,
details.toggle > summary > h5, details.toggle > summary > h6 { display: inline; }
.page figure { margin: 0.8em 0; }
.page figure img { display: block; max-width: 100%; height: auto; border-radius: 3px; }
.page figure.center img { margin: 0 auto; }
.page figure.right img { margin-left: auto; }
.page figure.center figcaption { text-align: center; }
.page figcaption { margin-top: 6px; color: #787774; font-size: 0.875em; }
.media audio, .media video { display: block; width: 100%; max-width: 100%; }
.math-block { position: relative; margin: 0.8em 0; padding: 4px 3.5em; overflow-x: auto; text-align: center; }
.eq-number { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); color: #787774; }
.page math { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", math; }
.page math[display="block"] { font-size: 1.15em; }
.page annotation { display: none; }
.katex-error { color: #c4372f; font-family: ${MONO}; font-size: 0.9em; }
.flashcard { display: grid; grid-template-columns: 1fr 1fr; margin: 0.6em 0; border: 1px solid #e3e2df; border-radius: 6px; background: #fbfbfa; }
.flashcard > div { padding: 10px 14px 12px; }
.flashcard > div + div { border-left: 1px solid #e3e2df; }
.fc-label { display: block; margin-bottom: 2px; color: #787774; font-size: 0.75em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.toc { display: flex; flex-direction: column; margin: 0.6em 0; }
.toc a { padding: 2px 0; color: #5f5e5b; text-decoration: underline; text-decoration-color: rgba(55, 53, 47, 0.25); text-underline-offset: 3px; }
.page-ref { font-weight: 500; text-decoration: underline; text-decoration-color: rgba(55, 53, 47, 0.3); text-underline-offset: 3px; }
.page-ref.missing, .muted { color: #9b9a97; text-decoration: none; }
.cite { color: #5f5e5b; }
.bibliography { margin: 0.6em 0; }
.bibliography p { margin: 0 0 6px; padding-left: 1.5em; text-indent: -1.5em; }
.attachment { margin: 0.6em 0; padding: 10px 14px; border: 1px solid #e3e2df; border-radius: 6px; }
.attachment-name { font-weight: 500; }
.attachment .download { margin-left: 8px; font-size: 0.875em; font-weight: 400; }
.pdf-quote { margin: 8px 0 0 !important; padding: 2px 10px !important; border-left: 3px solid #f5c400 !important; }
.pdf-page { margin-left: 4px; color: #787774; font-size: 0.85em; white-space: nowrap; }
.sketch svg { display: block; width: 100%; max-width: 800px; height: auto; border: 1px solid #e3e2df; border-radius: 6px; background: #fff; }
.database { margin: 0.8em 0; }
.db-title { margin-bottom: 4px; font-size: 1.1em; font-weight: 600; }
.tag { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 0.8em; line-height: 1.6; white-space: nowrap; }
.tag-gray { background: #e3e2e0; color: #32302c; }
.tag-brown { background: #eee0da; color: #442a1e; }
.tag-orange { background: #fadec9; color: #49290e; }
.tag-yellow { background: #fdecc8; color: #402c1b; }
.tag-green { background: #dbeddb; color: #1c3829; }
.tag-blue { background: #d3e5ef; color: #183347; }
.tag-purple { background: #e8deee; color: #412454; }
.tag-pink { background: #f5e0e9; color: #4c2337; }
.tag-red { background: #ffe2dd; color: #5d1715; }
.print-only { display: none; }
.page-break { height: 0; }
@media (max-width: 600px) {
  .page { padding: 32px 16px 64px; }
  .columns { flex-direction: column; gap: 0; }
  .flashcard { grid-template-columns: 1fr; }
  .flashcard > div + div { border-left: 0; border-top: 1px solid #e3e2df; }
}
@page { margin: 18mm 16mm 20mm; }
@media print {
  html, body { background: #fff; }
  .page { max-width: none; margin: 0; padding: 0; font-size: 11.5pt; }
  .page.small { font-size: 10pt; }
  .page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cover { height: 140px; margin-bottom: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .has-cover .page-icon { margin-top: -56px; }
  .page h1, .page h2, .page h3, .page h4, .page h5, .page h6, details.toggle > summary { break-after: avoid; page-break-after: avoid; break-inside: avoid; }
  .callout, .page table, .page tr, .page figure, .sketch, .flashcard, .math-block, .attachment, .page blockquote, .page img, .page svg,
  .columns { break-inside: avoid; page-break-inside: avoid; }
  .page thead { display: table-header-group; }
  .page .table, .page pre.code, .math-block { overflow: visible; }
  .page p, .page li { orphans: 3; widows: 3; }
  .page a { color: inherit; }
  .media audio, .media video { display: none; }
  .print-only { display: block; }
  .page-break { break-after: page; page-break-after: always; }
}
`;
