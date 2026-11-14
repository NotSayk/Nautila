import { strFromU8, unzipSync } from "fflate";
import { db } from "../db";
import { inferColumn, parseCsv, parseNotionRefs, type NotionRef } from "./csv";
import { createRow, getDatabase, getRowProps, newView, saveDatabase, setRowProps } from "./databases";
import type { Value } from "./dbquery";
import { fileId, linkFiles, saveFile } from "./files";
import { createPage } from "./pages";

/** Adresse d'un lien vers une autre page, dans un contenu importé ; l'éditeur en fait une mention de page. */
export const PAGE_LINK = "https://page.nautila.invalid/";

/** Préfixe d'un contenu HTML en attente de mise en forme (import Word). */
export const HTML_MARK = "<!--html-->";
/** Préfixe de blocs (JSON) en attente d'être posés dans la page (import PDF). */
export const BLOCKS_MARK = "<!--blocks-->";

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

/** Chemin d'une entrée d'archive, insensible à la forme Unicode (macOS écrit les noms décomposés). */
const entryKey = (path: string) => path.normalize("NFC");

/**
 * Remplace les images locales d'un fichier Markdown par des fichiers enregistrés dans la base.
 * Les chemins relatifs (`./img.png`, `../images/img.png`) sont résolus depuis le dossier de la page.
 * Renvoie aussi les identifiants des fichiers créés, pour les lier à la page.
 */
async function inlineImages(markdown: string, folder: string, entries: Map<string, Uint8Array>) {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  const lookup = new Map([...entries].map(([path, bytes]) => [entryKey(path), bytes]));
  const files: string[] = [];
  let out = "";
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    out += markdown.slice(last, match.index);
    last = match.index + match[0].length;
    let target: string | null = null;
    try {
      const relative = decodeURIComponent(match[2]);
      const bytes = lookup.get(entryKey(resolvePath(folder, relative))) ?? lookup.get(entryKey(relative));
      const type = MIME[relative.split(".").pop()?.toLowerCase() ?? ""];
      if (bytes && type) {
        target = await saveFile(new File([bytes as BlobPart], relative.split("/").pop()!, { type }));
        files.push(fileId(target)!);
      }
    } catch {
      /* image illisible ou trop lourde : le lien d'origine est conservé */
    }
    out += target ? `![${match[1]}](${target})` : match[0];
  }
  return { markdown: out + markdown.slice(last), files };
}

/** Identifiant Notion (32 chiffres hexadécimaux) à la fin d'un nom de fichier ou d'une adresse. */
const notionId = (path: string) =>
  /([0-9a-f]{32})(?:\.\w+)?(?:\?.*)?$/i.exec(path.replace(/-/g, ""))?.[1].toLowerCase();
const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** Chemin d'un lien relatif, ramené à la racine de l'archive (`..` et `.` résolus). */
function resolvePath(folder: string, relative: string) {
  const out: string[] = [];
  for (const part of [...(folder ? folder.split("/") : []), ...relative.split("/")]) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

async function importZip(file: File): Promise<string> {
  const entries = allEntries(new Uint8Array(await file.arrayBuffer()));
  const depth = (p: string) => p.split("/").length;
  const paths = [...entries.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  /** Chemin d'une page (sans extension) → identifiant ; sert à rattacher les sous-pages. */
  const byPath = new Map<string, string>();
  /** Dossier d'une base de données → ses lignes, par titre (plusieurs lignes peuvent avoir le même titre). */
  const databases = new Map<string, { id: string; rows: Map<string, string[]> }>();
  /** Lignes de base déjà rattachées à leur fichier Markdown : deux fichiers de même titre ne se partagent pas une ligne. */
  const claimed = new Set<string>();
  let first: string | undefined;
  /** Identifiant Notion → page créée, quand les fichiers de l'export portent encore leur identifiant. */
  const byNotionId = new Map<string, string>();
  /** Pages importées depuis un fichier Markdown : leurs liens internes sont réécrits à la fin. */
  const contents: { id: string; folder: string; content: string }[] = [];
  /** Colonnes qui ressemblent à des relations : résolues une fois toutes les bases créées. */
  const relations: { database: string; prop: string; cells: { row: string; refs: NotionRef[] }[] }[] = [];
  const remember = (path: string, id: string) => {
    byPath.set(path.replace(/\.(md|csv)$/i, "").replace(/_all$/, ""), id);
    const key = notionId(path);
    if (key) byNotionId.set(key, id);
  };

  // Notion exporte chaque base en CSV et range les pages de ses lignes dans un dossier du même nom.
  const csvPaths = paths.filter((p) => /\.csv$/i.test(p));
  const databaseFolders = new Set(csvPaths.map((p) => p.replace(/(_all)?\.csv$/i, "")));
  const mdPaths = paths.filter((p) => /\.md$/i.test(p));

  const importMarkdown = async (path: string) => {
    const folder = dirname(path);
    const { title, body } = splitMarkdown(strFromU8(entries.get(path)!), notionTitle(path));
    const { markdown: content, files } = await inlineImages(body, folder, entries);
    const database = databases.get(folder);
    // Une ligne de base est retrouvée par son titre, mais chaque ligne n'est prise qu'une fois ;
    // ensuite la page est connue par son chemin dans l'archive (voir `remember`).
    let id = database?.rows.get(title.trim())?.find((row) => !claimed.has(row));
    if (id) {
      claimed.add(id);
      await setContent(id, content);
    } else id = await importPage(title, content, database?.id ?? byPath.get(folder) ?? null);
    await linkFiles(id, files);
    remember(path, id);
    contents.push({ id, folder, content });
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
    const columns = header.slice(1).map((name, i) => {
      const cells = lines.map((l) => l[i + 1] ?? "");
      const refs = cells.map((c) => (c.trim() ? parseNotionRefs(c) : []));
      const column = inferColumn(name || `Colonne ${i + 2}`, cells, `c${i}`);
      // Relation probable : le texte ne garde que les titres, en attendant de retrouver les lignes liées.
      return refs.some((r) => r?.length) && refs.every((r) => r !== null)
        ? {
            prop: { id: `c${i}`, name: column.prop.name, type: "text" as const },
            convert: (_: string, line: number): Value => refs[line]!.map((r) => r.title).join(", ") || null,
            refs: refs as NotionRef[][],
          }
        : { ...column, refs: null };
    });
    const page = await createPage({
      title: notionTitle(path),
      kind: "database",
      parentId: byPath.get(dirname(path)) ?? null,
    });
    await saveDatabase(page.id, { props: columns.map((c) => c.prop), views: [newView("table", "Table")] });
    const rows = new Map<string, string[]>();
    const rowIds: string[] = [];
    for (const [index, line] of lines.entries()) {
      const values: Record<string, Value> = {};
      columns.forEach((c, i) => (values[c.prop.id] = c.convert(line[i + 1] ?? "", index)));
      const rowId = await createRow(page.id, values);
      await db().run("UPDATE pages SET title = ? WHERE id = ?", [line[0] ?? "", rowId]);
      const key = (line[0] ?? "").trim();
      rows.set(key, [...(rows.get(key) ?? []), rowId]);
      rowIds.push(rowId);
    }
    for (const column of columns)
      if (column.refs)
        relations.push({
          database: page.id,
          prop: column.prop.id,
          cells: column.refs.map((refs, i) => ({ row: rowIds[i], refs })),
        });
    databases.set(base, { id: page.id, rows });
    remember(path, page.id);
    first ??= page.id;
  }

  for (const path of mdPaths.filter((p) => databaseFolders.has(dirname(p)))) await importMarkdown(path);

  /** Page désignée par un lien de l'export : par identifiant Notion, sinon par chemin. */
  const pageOf = (target: string, folder: string) => {
    const key = notionId(target);
    if (key && byNotionId.has(key)) return byNotionId.get(key);
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
    const clean = decode(target.split(/[?#]/)[0])
      .replace(/\.(md|csv)$/i, "")
      .replace(/_all$/, "");
    return byPath.get(resolvePath(folder, clean)) ?? byPath.get(clean);
  };

  // Relations : chaque référence est rattachée à la ligne importée qu'elle désigne (à défaut, par son titre).
  const rowDatabase = new Map<string, string>();
  for (const d of databases.values())
    for (const ids of d.rows.values()) for (const id of ids) rowDatabase.set(id, d.id);
  for (const relation of relations) {
    const folder = dirname([...databases].find(([, d]) => d.id === relation.database)?.[0] ?? "");
    const resolved = relation.cells.map(({ row, refs }) => ({
      row,
      ids: refs.flatMap((ref) => {
        const direct = pageOf(ref.target, folder);
        if (direct && rowDatabase.has(direct)) return [direct];
        const byTitle = [...databases.values()].flatMap((d) => d.rows.get(ref.title.trim()) ?? []);
        return byTitle.length === 1 ? byTitle : [];
      }),
    }));
    // La base visée est celle de la majorité des lignes retrouvées ; les autres références sont écartées.
    const counts = new Map<string, number>();
    for (const { ids } of resolved)
      for (const id of ids) counts.set(rowDatabase.get(id)!, (counts.get(rowDatabase.get(id)!) ?? 0) + 1);
    const target = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const config = target && (await getDatabase(relation.database));
    if (!config) continue;
    await saveDatabase(relation.database, {
      ...config,
      props: config.props.map((p) => (p.id === relation.prop ? { ...p, type: "relation" as const, target } : p)),
    });
    for (const { row, ids } of resolved)
      await setRowProps(row, {
        ...(await getRowProps(row)),
        [relation.prop]: ids.filter((id) => rowDatabase.get(id) === target),
      });
  }

  // Liens d'une page vers une autre page de l'export : ils pointent désormais vers la page importée.
  for (const { id, folder, content } of contents) {
    const linked = content.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, text: string, target: string) => {
      const page = pageOf(target, folder);
      return page ? `[${text}](${PAGE_LINK}${page})` : whole;
    });
    if (linked !== content) await setContent(id, linked);
  }

  if (!first) throw new Error("nothing to import");
  return first;
}

async function importDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const files: string[] = [];
  // Les images sont gardées comme fichiers de la base, pas intégrées en base64 dans le document.
  const convertImage = mammoth.images.imgElement(async (image) => {
    const data = await image.read("base64");
    try {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const url = await saveFile(new File([bytes], "image", { type: image.contentType }));
      files.push(fileId(url)!);
      return { src: url };
    } catch {
      return { src: `data:${image.contentType};base64,${data}` };
    }
  });
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { convertImage });
  const id = await importPage(file.name.replace(/\.[^.]+$/, ""), HTML_MARK + value);
  await linkFiles(id, files);
  return id;
}

/** Un PDF devient une page à son nom, qui affiche le document (surlignable) ; le fichier est gardé tel quel. */
async function importPdf(file: File): Promise<string> {
  const url = await saveFile(file);
  const title = file.name.replace(/\.[^.]+$/, "");
  const page = await createPage({ title, icon: "📄" });
  const blocks = [{ type: "pdf", props: { url, name: file.name } }, { type: "paragraph" }];
  await db().run("UPDATE pages SET import_md = ?, body = ? WHERE id = ?", [
    BLOCKS_MARK + JSON.stringify(blocks),
    title,
    page.id,
  ]);
  await linkFiles(page.id, [fileId(url)]);
  return page.id;
}

/** Seuls les fichiers Markdown et texte brut sont lus comme du texte. */
export const isTextFile = (file: { name: string; type: string }) =>
  /\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith("text/");

/** Importe des fichiers Markdown, Word, PDF ou des archives ; renvoie la page à ouvrir et les fichiers refusés. */
export async function importFiles(files: File[]): Promise<{ open?: string; failed: string[] }> {
  const failed: string[] = [];
  let open: string | undefined;
  for (const file of files) {
    try {
      if (/\.zip$/i.test(file.name)) open = await importZip(file);
      else if (/\.docx$/i.test(file.name)) open = await importDocx(file);
      else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") open = await importPdf(file);
      else if (isTextFile(file)) {
        const { title, body } = splitMarkdown(await file.text(), file.name.replace(/\.[^.]+$/, ""));
        open = await importPage(title, body);
      } else failed.push(file.name); // ni Markdown ni texte : pas de page de caractères illisibles
    } catch {
      failed.push(file.name);
    }
  }
  return { open, failed };
}
