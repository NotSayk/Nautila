/** Lecture en base de tout ce dont l'export d'une page a besoin (fichiers, références, blocs synchronisés…). */
import { getDatabase, listRows } from "../data/databases";
import { applyView, withFormulas } from "../data/dbquery";
import { FILE_SCHEME, readStoredFile, resolveFileUrl } from "../data/files";
import { getPageDoc, type PageMeta } from "../data/pages";
import { listRefs } from "../data/refs";
import { codeTokens } from "../editor/highlight";
import { codeKey, collectNeeds, emptySources, type ExportBlock, type ExportFile, type ExportSources } from "./html";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Fichier de la base locale, ou d'une page partagée par un autre participant (demandé au serveur). */
async function loadFile(url: string): Promise<ExportFile | null> {
  if (!url.startsWith(FILE_SCHEME)) return null;
  const stored = await readStoredFile(url);
  if (stored) return stored;
  try {
    const resolved = await resolveFileUrl(url);
    if (!resolved) return null;
    const blob = await (await fetch(resolved)).blob();
    return { name: "", mime: blob.type || "application/octet-stream", data: await blobToBase64(blob) };
  } catch {
    return null;
  }
}

export async function prepareExport(
  blocks: ExportBlock[],
  options: {
    pages: PageMeta[];
    cover: string | null;
    /** Blocs d'un contenu Yjs enregistré (base64), lus avec le schéma de l'éditeur. */
    readDoc: (ydoc: string) => ExportBlock[];
    /** Faux pour un export qui n'intègre ni fichiers ni code coloré (Markdown). */
    embed?: boolean;
  },
): Promise<ExportSources> {
  const sources = emptySources();
  for (const p of options.pages) sources.pages.set(p.id, { title: p.title, icon: p.icon });
  sources.refs = await listRefs().catch(() => []);

  // Blocs synchronisés : leur contenu peut lui-même en contenir d'autres.
  for (let needs = collectNeeds(blocks, sources); ; needs = collectNeeds(blocks, sources)) {
    const missing = [...needs.synced].filter((id) => !sources.synced.has(id));
    if (missing.length === 0) break;
    for (const id of missing) {
      let content: ExportBlock[] = [];
      try {
        const { ydoc } = await getPageDoc(id);
        if (ydoc) content = options.readDoc(ydoc);
      } catch {
        /* contenu illisible : le bloc est omis */
      }
      sources.synced.set(id, content);
    }
  }

  const needs = collectNeeds(blocks, sources);
  const embed = options.embed ?? true;
  const urls = new Set(embed ? needs.files : []);
  if (options.cover && !options.cover.startsWith("color:")) urls.add(options.cover);
  for (const url of urls) {
    const file = await loadFile(url);
    if (file) sources.files.set(url, file);
  }

  for (const id of needs.databases) {
    try {
      const config = await getDatabase(id);
      const props = config?.props ?? [];
      const rows = withFormulas(await listRows(id), props);
      const view = config?.views[0];
      const page = sources.pages.get(id);
      sources.databases.set(id, {
        title: page?.title ?? "",
        icon: page?.icon ?? null,
        props,
        rows: view ? applyView(rows, view, props) : rows,
      });
    } catch {
      /* base illisible : omise */
    }
  }

  for (const { language, code } of embed ? needs.code : []) {
    const key = codeKey(language, code);
    if (sources.code.has(key)) continue;
    const tokens = await codeTokens(code, language);
    if (tokens) sources.code.set(key, tokens);
  }
  return sources;
}
