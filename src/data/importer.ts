import { strFromU8, unzipSync } from "fflate";
import { createPage } from "./pages";
import { pendingHtml, pendingMarkdown } from "./templates";

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
  return name.replace(/\.md$/i, "").replace(/\s+[0-9a-f]{32}$/i, "");
}

/** Fichiers Markdown d'une archive, y compris ceux d'archives imbriquées (exports Notion en plusieurs parties). */
function markdownEntries(zip: Uint8Array, prefix = ""): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const [path, bytes] of Object.entries(unzipSync(zip))) {
    if (/\.zip$/i.test(path)) out.push(...markdownEntries(bytes, prefix));
    else if (/\.md$/i.test(path)) out.push({ path: prefix + path, text: strFromU8(bytes) });
  }
  return out;
}

async function importZip(file: File): Promise<string | undefined> {
  const entries = markdownEntries(new Uint8Array(await file.arrayBuffer()));
  // Notion range les sous-pages dans un dossier portant le nom de la page parente :
  // en créant les parents d'abord, chaque fichier retrouve le sien.
  entries.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  const byPath = new Map<string, string>();
  let first: string | undefined;
  for (const entry of entries) {
    const folder = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
    const { title, body } = splitMarkdown(entry.text, notionTitle(entry.path));
    const page = await createPage({ title, parentId: byPath.get(folder) ?? null });
    pendingMarkdown.set(page.id, body);
    byPath.set(entry.path.replace(/\.md$/i, ""), page.id);
    first ??= page.id;
  }
  if (!first) throw new Error("no markdown in archive");
  return first;
}

async function importDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const page = await createPage({ title: file.name.replace(/\.[^.]+$/, "") });
  pendingHtml.set(page.id, value);
  return page.id;
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
        const page = await createPage({ title });
        pendingMarkdown.set(page.id, body);
        open = page.id;
      }
    } catch {
      failed.push(file.name);
    }
  }
  return { open, failed };
}
