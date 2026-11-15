import { validShareId } from "./sync/ids";

export type Route =
  | { view: "home" }
  | { view: "review" }
  | { view: "tasks" }
  | { view: "trash" }
  | { view: "timetable" }
  | { view: "join"; id: string; invite?: string }
  | { view: "view"; id: string }
  | { view: "page"; id: string };

/**
 * Écran désigné par l'adresse (`#/page/<id>`, `#/join/<id>[/<secret>]`…). Les identifiants de
 * partage, qui finissent dans des chemins d'API, sont validés strictement : un lien forgé
 * (`#/join/<id>\delete`, `%2e%2e`…) ramène à l'accueil.
 */
export function parseRoute(hash: string): Route {
  const [view, id, invite, ...rest] = hash.replace(/^#\/?/, "").split("/");
  if (view === "join" || view === "view") {
    const extra = rest.length > 0 || (invite !== undefined && (view === "view" || !validShareId(invite)));
    if (!validShareId(id) || extra) return { view: "home" };
    return view === "join" && invite ? { view, id, invite } : { view, id };
  }
  if (view === "page" && id) return { view, id };
  if (view === "review" || view === "tasks" || view === "trash" || view === "timetable") return { view };
  return { view: "home" };
}

export const routeHash = (route: Route) =>
  route.view === "join"
    ? `/join/${route.id}${route.invite ? `/${route.invite}` : ""}`
    : route.view === "page" || route.view === "view"
      ? `/${route.view}/${route.id}`
      : route.view === "home"
        ? "/"
        : `/${route.view}`;
