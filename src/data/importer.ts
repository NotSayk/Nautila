import { strFromU8, unzipSync } from "fflate";
import { db } from "../db";
import { inferColumn, parseCsv } from "./csv";
import { createRow, newView, saveDatabase } from "./databases";
import type { Value } from "./dbquery";
import { saveFile } from "./files";
import { createPage } from "./pages";

/** Préfixe d'un contenu HTML en attente de mise en forme (import Word). */
export const HTML_MARK = "<!--html-->";

/** Titre et corps d'un fichier Markdown : un titre de niveau 1 en tête devient le titre de la page. */
export function splitMarkdown(text: string, fallbackTitle: string): { title: string; body: string } {
  const heading = text.match(/^\s*# (.+)\r?\n?/);
  return heading
    ? { title: heading[1].trim(), body: text.slice(heading[0].length) }
    : { title: fallbackTitle, body: text };
}

/** Nom lisible d'un fichier d'export Notion : sans dossier, extension ni identifiant final. */
export function notionTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.(md|csv)$/i, "")
    .replace(/_all$/, "")
    .replace(/\s+[0-9a-f]{32}$/i, "");
}

/**
 * Enregistre le contenu d'une page importée. Il est mis en forme à sa première
 * ouverture ; d'ici là il reste en base, donc rien n'est perdu si on ferme l'application.
 */
const setContent = (pageId: string, content: string) =>
  db().run("UPDATE pages SET import_md = ?, body = ? WHERE id = ?", [content, content.replace(HTML_MARK, ""), pageId]);

async function importPage(title: string, content: string, parentId: string | null = null) {
  const page = await createPage({ title, parentId });
  await setContent(page.id, content);
  return page.id;
}

/** Tous les fichiers d'une archive, y compris ceux d'archives imbriquées (exports Notion en plusieurs parties). */
function allEntries(zip: Uint8Array, out = new Map<string, Uint8Array>()) {
  for (const [path, bytes] of Object.entries(unzipSync(zip))) {
    if (/\.zip$/i.test(path)) allEntries(bytes, out);
    else if (!path.endsWith("/")) out.set(path, bytes);
  }
  return out;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Remplace les images locales d'un fichier Markdown par des fichiers enregistrés dans la base. */
async function inlineImages(markdown: string, folder: string, entries: Map<string, Uint8Array>) {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let out = "";
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    out += markdown.slice(last, match.index);
    last = match.index + match[0].length;
    let target: string | null = null;
    try {
      const relative = decodeURIComponent(match[2]);
      const bytes = entries.get(folder ? `${folder}/${relative}` : relative);
      const type = MIME[relative.split(".").pop()?.toLowerCase() ?? ""];
      if (bytes && type) target = await saveFile(new File([bytes as BlobPart], relative.split("/").pop()!, { type }));
    } catch {
      /* image illisible ou trop lourde : le lien d'origine est conservé */
    }
    out += target ? `![${match[1]}](${target})` : match[0];
  }
  return out + markdown.slice(last);
}

async function importZip(file: File): Promise<string> {
  const entries = allEntries(new Uint8Array(await file.arrayBuffer()));
  const depth = (p: string) => p.split("/").length;
  const paths = [...entries.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  /** Chemin d'une page (sans extension) → identifiant ; sert à rattacher les sous-pages. */
  const byPath = new Map<string, string>();
  /** Dossier d'une base de données → ses lignes, par titre. */
  const databases = new Map<string, { id: string; rows: Map<string, string> }>();
  let first: string | undefined;

  // Notion exporte chaque base en CSV et range les pages de ses lignes dans un dossier du même nom.
  const csvPaths = paths.filter((p) => /\.csv$/i.test(p));
  const databaseFolders = new Set(csvPaths.map((p) => p.replace(/(_all)?\.csv$/i, "")));
  const mdPaths = paths.filter((p) => /\.md$/i.test(p));

  const importMarkdown = async (path: string) => {
    const folder = dirname(path);
    const { title, body } = splitMarkdown(strFromU8(entries.get(path)!), notionTitle(path));
    const content = await inlineImages(body, folder, entries);
    const database = databases.get(folder);
    let id = database?.rows.get(title.trim());
    if (id) await setContent(id, content);
    else id = await importPage(title, content, database?.id ?? byPath.get(folder) ?? null);
    byPath.set(path.replace(/\.md$/i, ""), id);
    first ??= id;
  };

  // D'abord les pages ordinaires, pour que chaque base trouve sa page parente ;
  // ensuite les bases, puis le contenu de leurs lignes.
  for (const path of mdPaths.filter((p) => !databaseFolders.has(dirname(p)))) await importMarkdown(path);

  for (const path of csvPaths) {
    const base = path.replace(/(_all)?\.csv$/i, "");
    if (databases.has(base)) continue;
    const [header, ...lines] = parseCsv(strFromU8(entries.get(path)!));
    if (!header) continue;
    const columns = header.slice(1).map((name, i) =>
      inferColumn(
        name || `Colonne ${i + 2}`,
        lines.map((l) => l[i + 1] ?? ""),
        `c${i}`,
      ),
    );
    const page = await createPage({
      title: notionTitle(path),
      kind: "database",
      parentId: byPath.get(dirname(path)) ?? null,
    });
    await saveDatabase(page.id, { props: columns.map((c) => c.prop), views: [newView("table", "Table")] });
    const rows = new Map<string, string>();
    for (const line of lines) {
      const values: Record<string, Value> = {};
      columns.forEach((c, i) => (values[c.prop.id] = c.convert(line[i + 1] ?? "")));
      const rowId = await createRow(page.id, values);
      await db().run("UPDATE pages SET title = ? WHERE id = ?", [line[0] ?? "", rowId]);
      rows.set((line[0] ?? "").trim(), rowId);
    }
    databases.set(base, { id: page.id, rows });
    byPath.set(base, page.id);
    first ??= page.id;
  }

  for (const path of mdPaths.filter((p) => databaseFolders.has(dirname(p)))) await importMarkdown(path);

  if (!first) throw new Error("nothing to import");
  return first;
}

async function importDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return importPage(file.name.replace(/\.[^.]+$/, ""), HTML_MARK + value);
}

/** Importe des fichiers Markdown, Word ou des archives ; renvoie la page à ouvrir et les fichiers refusés. */
export async function importFiles(files: File[]): Promise<{ open?: string; failed: string[] }> {
  const failed: string[] = [];
  let open: string | undefined;
  for (const file of files) {
    try {
      if (/\.zip$/i.test(file.name)) open = await importZip(file);
      else if (/\.docx$/i.test(file.name)) open = await importDocx(file);
      else {
        const { title, body } = splitMarkdown(await file.text(), file.name.replace(/\.[^.]+$/, ""));
        open = await importPage(title, body);
      }
    } catch {
      failed.push(file.name);
    }
  }
  return { open, failed };
}
