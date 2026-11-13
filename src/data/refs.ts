import { db } from "../db";

export type Reference = { key: string; title: string; author: string; year: string; bibtex: string };

/** Lit un fichier BibTeX : une entrée par `@type{clé, champ = {valeur}, …}`. */
export function parseBibtex(text: string): Reference[] {
  const out: Reference[] = [];
  const entry = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  for (let match = entry.exec(text); match; match = entry.exec(text)) {
    if (/^(comment|string|preamble)$/i.test(match[1])) continue;
    // L'entrée se termine à l'accolade qui referme celle de son ouverture.
    let depth = 1;
    let end = entry.lastIndex;
    while (end < text.length && depth > 0) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}") depth--;
      end++;
    }
    const body = text.slice(entry.lastIndex, end - 1);
    const field = (name: string) => {
      const found = new RegExp(`\\b${name}\\s*=\\s*`, "i").exec(body);
      if (!found) return "";
      let i = found.index + found[0].length;
      let value = "";
      if (body[i] === "{") {
        let level = 0;
        for (; i < body.length; i++) {
          if (body[i] === "{") level++;
          else if (body[i] === "}" && --level === 0) break;
          if (level > 0) value += body[i];
        }
        value = value.slice(1);
      } else if (body[i] === '"') value = body.slice(i + 1, body.indexOf('"', i + 1));
      else value = /^[^,\s]+/.exec(body.slice(i))?.[0] ?? "";
      return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    };
    out.push({
      key: match[2],
      title: field("title"),
      author: field("author"),
      year: field("year") || (/\d{4}/.exec(field("date"))?.[0] ?? ""),
      bibtex: text.slice(match.index, end).trim(),
    });
    entry.lastIndex = end;
  }
  return out;
}

/** « Dupont et Martin » ou « Dupont et al. », d'après le champ author de BibTeX. */
export function shortAuthors(author: string): string {
  const names = author
    .split(/\s+and\s+/i)
    .map((a) => (a.includes(",") ? a.split(",")[0] : (a.trim().split(/\s+/).pop() ?? "")).trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return names.length === 2 ? `${names[0]} et ${names[1]}` : `${names[0]} et al.`;
}

export const citeLabel = (ref: Reference) => [shortAuthors(ref.author) || ref.key, ref.year].filter(Boolean).join(", ");

export const listRefs = () =>
  db().all<Reference>("SELECT key, title, author, year, bibtex FROM refs ORDER BY author, year");

export async function importRefs(text: string): Promise<number> {
  const refs = parseBibtex(text);
  for (const r of refs)
    await db().run("INSERT OR REPLACE INTO refs (key, title, author, year, bibtex, created_at) VALUES (?,?,?,?,?,?)", [
      r.key,
      r.title,
      r.author,
      r.year,
      r.bibtex,
      Date.now(),
    ]);
  return refs.length;
}

export const deleteRef = (key: string) => db().run("DELETE FROM refs WHERE key = ?", [key]);
