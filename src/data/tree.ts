/** Identifiants d'une page et de tous ses descendants. */
export function subtreeIds(pages: { id: string; parent_id: string | null }[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pages) {
      if (p.parent_id && ids.has(p.parent_id) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return ids;
}
