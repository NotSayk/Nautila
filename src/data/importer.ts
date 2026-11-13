import { strFromU8, unzipSync } from "fflate";
import { db } from "../db";
import { inferColumn, parseCsv, parseNotionRefs, type NotionRef } from "./csv";
import { createRow, getDatabase, getRowProps, newView, saveDatabase, setRowProps } from "./databases";
import type { Value } from "./dbquery";
import { saveFile } from "./files";
import { createPage } from "./pages";

/** Adresse d'un lien vers une autre page, dans un contenu importé ; l'éditeur en fait une mention de page. */
export const PAGE_LINK = "https://page.nautila.invalid/";

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
  /** Dossier d'une base de données → ses lignes, par titre. */
  const databases = new Map<string, { id: string; rows: Map<string, string> }>();
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
    const content = await inlineImages(body, folder, entries);
    const database = databases.get(folder);
    let id = database?.rows.get(title.trim());
    if (id) await setContent(id, content);
    else id = await importPage(title, content, database?.id ?? byPath.get(folder) ?? null);
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
    const rows = new Map<string, string>();
    const rowIds: string[] = [];
    for (const [index, line] of lines.entries()) {
      const values: Record<string, Value> = {};
      columns.forEach((c, i) => (values[c.prop.id] = c.convert(line[i + 1] ?? "", index)));
      const rowId = await createRow(page.id, values);
      await db().run("UPDATE pages SET title = ? WHERE id = ?", [line[0] ?? "", rowId]);
      rows.set((line[0] ?? "").trim(), rowId);
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
  for (const d of databases.values()) for (const id of d.rows.values()) rowDatabase.set(id, d.id);
  for (const relation of relations) {
    const folder = dirname([...databases].find(([, d]) => d.id === relation.database)?.[0] ?? "");
    const resolved = relation.cells.map(({ row, refs }) => ({
      row,
      ids: refs.flatMap((ref) => {
        const direct = pageOf(ref.target, folder);
        if (direct && rowDatabase.has(direct)) return [direct];
        const byTitle = [...databases.values()].flatMap((d) => d.rows.get(ref.title) ?? []);
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
