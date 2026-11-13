import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { db } from "../db";
import { createPage, updatePageMeta } from "../data/pages";
import { fromBase64, toBase64 } from "../util/base64";
import { getSyncState, REMOTE_DOC_EVENT, SyncError } from "./engine";

const REMOTE = "share-remote";

async function account() {
  const state = await getSyncState();
  if (!state.server || !state.token) throw new SyncError(401, "auth");
  return { server: state.server, token: state.token };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { server, token } = await account();
  let res: Response;
  try {
    res = await fetch(`${server}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SyncError(0, "offline");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(res.status, json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** Adresse à transmettre pour inviter quelqu'un sur une page partagée. */
export async function shareLink(shareId: string) {
  return `${(await account()).server}/#/join/${shareId}`;
}

/** Identifiant de partage contenu dans une adresse d'invitation, ou saisi tel quel. */
export const parseShareId = (input: string) => /([\w-]{16,})\s*$/.exec(input.trim())?.[1] ?? null;

/** Met une page en partage ; renvoie l'identifiant à transmettre. */
export async function createShare(pageId: string, title: string, ydoc: string | null): Promise<string> {
  const { id } = await post<{ id: string }>("share", { title, ydoc });
  await updatePageMeta(pageId, { share_id: id });
  return id;
}

/** Ajoute une page partagée à cet appareil (ou retrouve celle qui y est déjà). */
export async function joinShare(shareId: string): Promise<string> {
  const [existing] = await db().all<{ id: string }>("SELECT id FROM pages WHERE share_id = ? AND deleted_at IS NULL", [
    shareId,
  ]);
  if (existing) return existing.id;
  const share = await post<{ title: string; ydoc: string }>(`share/${shareId}`, {});
  const page = await createPage({ title: share.title });
  await db().run("UPDATE pages SET ydoc = ?, share_id = ? WHERE id = ?", [share.ydoc, shareId, page.id]);
  return page.id;
}

/** Arrête le partage pour tout le monde (propriétaire) ou détache seulement cet appareil. */
export async function leaveShare(pageId: string, shareId: string) {
  await post(`share/${shareId}/delete`, {}).catch(() => undefined);
  await updatePageMeta(pageId, { share_id: null });
}

/** Droit de ce compte sur une page partagée ; "none" : le propriétaire l'a retiré. */
export type ShareRole = "owner" | "edit" | "view" | "none";
/** Dernier droit connu sur cet appareil, pour ne pas ouvrir en écriture une page qu'on ne peut que lire. */
export function knownRole(shareId: string | null | undefined): ShareRole {
  try {
    const role = shareId && localStorage.getItem(`nautila.role.${shareId}`);
    return role === "view" || role === "none" || role === "owner" ? role : "edit";
  } catch {
    return "edit";
  }
}

function rememberRole(shareId: string, role: ShareRole) {
  try {
    localStorage.setItem(`nautila.role.${shareId}`, role);
  } catch {
    /* non mémorisé, sans gravité */
  }
}

/** Empreinte courte d'un document, pour savoir s'il a changé depuis le dernier envoi. */
function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${h >>> 0}`;
}
const pushedKey = (shareId: string) => `nautila.shared.${shareId}`;
function lastPushed(shareId: string): string | null {
  try {
    return localStorage.getItem(pushedKey(shareId));
  } catch {
    return null;
  }
}
function markPushed(shareId: string, ydoc: string) {
  try {
    localStorage.setItem(pushedKey(shareId), fingerprint(ydoc));
  } catch {
    /* le document sera simplement renvoyé au prochain passage */
  }
}

type RemoteShare = { id: string; role: ShareRole | "gone"; update?: string; sv?: string };

/**
 * Met à jour les pages partagées de cet appareil sans qu'elles soient ouvertes :
 * récupère les modifications des autres participants, et envoie celles faites ici
 * hors connexion ou page fermée. Renvoie vrai si une page a changé.
 */
export async function syncSharedPages(): Promise<boolean> {
  const pages = await db().all<{ id: string; share_id: string; ydoc: string | null }>(
    "SELECT id, share_id, ydoc FROM pages WHERE share_id IS NOT NULL AND deleted_at IS NULL",
  );
  if (pages.length === 0) return false;
  const { shares } = await post<{ shares: RemoteShare[] }>("shares/state", {
    shares: pages.map((p) => ({
      id: p.share_id,
      sv: p.ydoc ? toBase64(Y.encodeStateVectorFromUpdate(fromBase64(p.ydoc))) : "",
    })),
  });
  const byId = new Map(shares.map((s) => [s.id, s]));
  let changed = false;

  for (const page of pages) {
    const remote = byId.get(page.share_id);
    if (!remote) continue;
    const role: ShareRole = remote.role === "gone" ? "none" : remote.role;
    rememberRole(page.share_id, role);
    if (role === "none" || !remote.update) continue;

    const doc = new Y.Doc();
    if (page.ydoc) Y.applyUpdate(doc, fromBase64(page.ydoc));
    let touched = false;
    doc.on("update", () => (touched = true));
    Y.applyUpdate(doc, fromBase64(remote.update), REMOTE);
    let ydoc = page.ydoc;
    if (touched || !ydoc) {
      ydoc = toBase64(Y.encodeStateAsUpdate(doc));
      // Enregistré comme une modification locale : les autres appareils du compte la recevront aussi.
      await db().run("UPDATE pages SET ydoc = ? WHERE id = ?", [ydoc, page.id]);
      window.dispatchEvent(new CustomEvent(REMOTE_DOC_EVENT, { detail: { id: page.id, ydoc: remote.update } }));
      changed = true;
    }

    // Ce que cet appareil a écrit et que le serveur n'a pas encore (page modifiée hors du partage en direct).
    if ((role === "owner" || role === "edit") && remote.sv && lastPushed(page.share_id) !== fingerprint(ydoc)) {
      const missing = Y.encodeStateAsUpdate(doc, fromBase64(remote.sv));
      await post(`share/${page.share_id}/update`, { update: toBase64(missing) });
      markPushed(page.share_id, ydoc);
    }
    doc.destroy();
  }
  return changed;
}

type Handlers = {
  onPeers: (count: number) => void;
  onState: (online: boolean) => void;
  onRole: (role: ShareRole) => void;
};

/**
 * Relie un document ouvert à sa salle sur le serveur : les modifications
 * partent au fil de l'eau et celles des autres arrivent par un flux continu.
 * Renvoie la fonction qui ferme la session.
 */
export function startShareSession(shareId: string, doc: Y.Doc, awareness: Awareness, handlers: Handlers): () => void {
  const abort = new AbortController();
  let conn: string | null = null;
  let queue: Uint8Array[] = [];
  let sending = false;
  let role = knownRole(shareId);

  const flush = async () => {
    // En lecture seule rien ne part : le serveur refuserait la modification.
    if (role === "view" || role === "none") return void (queue = []);
    if (sending || !conn || queue.length === 0) return;
    sending = true;
    const update = Y.mergeUpdates(queue);
    queue = [];
    try {
      await post(`share/${shareId}/update`, { conn, update: toBase64(update) });
    } catch {
      queue.unshift(update); // sera renvoyé à la reconnexion
    }
    sending = false;
    if (queue.length > 0) void flush();
  };

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    queue.push(update);
    void flush();
  };
  const onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE || !conn) return;
    const update = toBase64(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
    void post(`share/${shareId}/awareness`, { conn, update }).catch(() => undefined);
  };
  doc.on("update", onUpdate);
  awareness.on("update", onAwareness);

  const handle = (event: { type: string; conn?: string; update?: string; peers?: number; role?: ShareRole }) => {
    if (event.role) {
      role = event.role;
      rememberRole(shareId, role);
      handlers.onRole(role);
    }
    if (event.type === "sync" && event.update && event.conn) {
      conn = event.conn;
      const remote = fromBase64(event.update);
      Y.applyUpdate(doc, remote, REMOTE);
      // Ce que cet appareil a écrit hors connexion et que le serveur n'a pas encore.
      const missing = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(remote));
      queue.push(missing);
      void flush();
      handlers.onState(true);
      if (awareness.getLocalState()) onAwareness({ added: [awareness.clientID], updated: [], removed: [] }, null);
    } else if (event.type === "update" && event.update) Y.applyUpdate(doc, fromBase64(event.update), REMOTE);
    else if (event.type === "awareness" && event.update)
      applyAwarenessUpdate(awareness, fromBase64(event.update), REMOTE);
    if (event.peers !== undefined) handlers.onPeers(event.peers);
  };

  (async () => {
    while (!abort.signal.aborted) {
      try {
        const { server, token } = await account();
        const res = await fetch(`${server}/api/share/${shareId}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (res.status === 403 || res.status === 404) {
          // Accès retiré ou partage arrêté : inutile de réessayer.
          handlers.onRole("none");
          handlers.onState(false);
          handlers.onPeers(0);
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith("data: ")) handle(JSON.parse(frame.slice(6)));
          }
        }
      } catch {
        /* coupure réseau ou serveur injoignable : nouvelle tentative plus bas */
      }
      conn = null;
      handlers.onState(false);
      handlers.onPeers(0);
      if (role === "none") return;
      if (!abort.signal.aborted) await new Promise((r) => setTimeout(r, 3000));
    }
  })();

  return () => {
    abort.abort();
    doc.off("update", onUpdate);
    awareness.off("update", onAwareness);
    // Efface les curseurs des autres participants, devenus sans objet.
    removeAwarenessStates(
      awareness,
      [...awareness.getStates().keys()].filter((id) => id !== awareness.clientID),
      REMOTE,
    );
  };
}

export type ShareMember = { id: number; username: string; role: "edit" | "view" | "none" | null };
export type ShareInfo = {
  owner: boolean;
  role: ShareRole;
  /** Droit de ceux qui rejoignent par le lien, sauf réglage particulier. */
  access: "edit" | "view";
  public: boolean;
  /** Participants, visibles du propriétaire seulement. */
  members?: ShareMember[];
};

/** Réglages d'une page partagée, vus par ce compte. */
export const shareInfo = (shareId: string) => post<ShareInfo>(`share/${shareId}`, {});

/** Droit général de ceux qui rejoignent par le lien (propriétaire seulement). */
export const setShareAccess = (shareId: string, access: "edit" | "view") =>
  post<Pick<ShareInfo, "access" | "members">>(`share/${shareId}/access`, { access });

/** Droit d'un participant ; `null` le remet sur le réglage général, "none" le retire. */
export const setMemberRole = (shareId: string, user: number, role: ShareMember["role"]) =>
  post<Pick<ShareInfo, "access" | "members">>(`share/${shareId}/member`, { user, role });

/** Active ou coupe le lien public en lecture seule (propriétaire seulement). */
export const setSharePublic = (shareId: string, enabled: boolean) =>
  post<{ public: boolean }>(`share/${shareId}/public`, { public: enabled });

export async function publicLink(shareId: string) {
  return `${(await account()).server}/#/view/${shareId}`;
}
