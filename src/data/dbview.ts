/** Réglages des vues d'une base : ordre, filtres, copies, liens (fonctions pures). */
import { convertTargets } from "./dbconvert";
import { opsFor, orderedProps, type DbConfig, type DbView, type Filter, type Prop, type PropType } from "./dbquery";

/** Liste d'identifiants avec `id` replacé avant `beforeId` (à la fin si null). */
export function moveItem(ids: string[], id: string, beforeId: string | null): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? -1 : rest.indexOf(beforeId);
  if (at < 0) return [...rest, id];
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Ordre des propriétés de la vue après le déplacement de `id` avant `beforeId` ; écrit l'ordre complet. */
export function moveProp(view: Pick<DbView, "order">, props: Prop[], id: string, beforeId: string | null): string[] {
  return moveItem(
    orderedProps(props, view).map((p) => p.id),
    id,
    beforeId,
  );
}

/** Décale une propriété d'un cran dans l'ordre de la vue. */
export function nudgeProp(view: Pick<DbView, "order">, props: Prop[], id: string, delta: -1 | 1): string[] {
  const ids = orderedProps(props, view).map((p) => p.id);
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return ids;
}

const cloneFilter = (f: Filter, newId: () => string): Filter => ({
  ...f,
  id: newId(),
  ...(f.group ? { group: f.group.map((g) => cloneFilter(g, newId)) } : {}),
});

/** Copie d'une vue, avec ses réglages, sous un nouvel identifiant. */
export function duplicateView(view: DbView, id: string, name: string, newId: () => string): DbView {
  const copy = JSON.parse(JSON.stringify(view)) as DbView;
  return { ...copy, id, name, filters: view.filters.map((f) => cloneFilter(f, newId)) };
}

/** Copie d'une propriété juste après l'originale (les options gardent leurs identifiants : ils sont propres à la propriété). */
export function duplicateProp(config: DbConfig, propId: string, id: string, name: string): DbConfig {
  const at = config.props.findIndex((p) => p.id === propId);
  if (at < 0) return config;
  // Une copie de relation bidirectionnelle serait un miroir sans pendant : elle devient une relation simple.
  const { twin: _twin, ...rest } = JSON.parse(JSON.stringify(config.props[at])) as Prop;
  const props = [...config.props];
  props.splice(at + 1, 0, { ...rest, id, name });
  // La copie vient juste après l'original dans les vues qui ordonnent leurs propriétés.
  const views = config.views.map((v) => {
    if (!v.order) return v;
    const order = [...v.order];
    const i = order.indexOf(propId);
    order.splice(i < 0 ? order.length : i + 1, 0, id);
    return { ...v, order };
  });
  return { props, views };
}

/** Nouveau filtre sur une propriété, avec son premier opérateur. */
export function newFilter(id: string, propId: string, props: Prop[]): Filter {
  const type = propId === "title" ? "title" : props.find((p) => p.id === propId)?.type;
  return { id, prop: propId, op: opsFor(type ?? "title")[0], value: "" };
}

/** Applique `change` au filtre `id`, où qu'il soit dans les groupes. */
export function mapFilter(filters: Filter[], id: string, change: (f: Filter) => Filter): Filter[] {
  return filters.map((f) => {
    if (f.id === id) return change(f);
    return f.group ? { ...f, group: mapFilter(f.group, id, change) } : f;
  });
}

/** Filtres sans `id` ; un groupe vidé disparaît. */
export function dropFilter(filters: Filter[], id: string): Filter[] {
  return filters.flatMap((f) => {
    if (f.id === id) return [];
    if (!f.group) return [f];
    const group = dropFilter(f.group, id);
    return group.length ? [{ ...f, group }] : [];
  });
}

/** Ajoute un filtre au niveau supérieur, ou dans le groupe `groupId`. */
export function addFilter(filters: Filter[], filter: Filter, groupId: string | null = null): Filter[] {
  if (groupId === null) return [...filters, filter];
  return mapFilter(filters, groupId, (g) => ({ ...g, group: [...(g.group ?? []), filter] }));
}

/** Nombre de conditions (un groupe ne compte que par ses filtres). */
export const countFilters = (filters: Filter[]): number =>
  filters.reduce((n, f) => n + (f.group ? countFilters(f.group) : 1), 0);

/** Nouvel état des groupes repliés après un clic sur l'un d'eux. */
export function toggleCollapsed(collapsed: string[] | undefined, key: string): string[] {
  const list = collapsed ?? [];
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

const PLAIN: PropType[] = ["text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "phone"];

/** Types vers lesquels convertir une propriété : tous les types simples si elle est vide, sinon ceux qui gardent le sens. */
export function convertibleTypes(type: PropType, hasValues: boolean): PropType[] {
  if (hasValues) return convertTargets(type);
  return PLAIN.filter((t) => t !== type);
}

/**
 * Adresse à ouvrir pour un lien (URL, e-mail, téléphone) ; null si la valeur ne s'y prête pas.
 * Seuls http, https, mailto et tel sont produits : jamais de `javascript:`.
 */
export function linkHref(type: PropType, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null;
  if (type === "phone") return /^\+?[\d\s().-]{3,}$/.test(v) ? `tel:${v.replace(/[^\d+]/g, "")}` : null;
  if (type !== "url") return null;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  // « exemple.fr/page » sans schéma : on suppose https.
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : null;
}
