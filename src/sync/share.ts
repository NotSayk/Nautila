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
import { getSyncState, SyncError } from "./engine";

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

type Handlers = { onPeers: (count: number) => void; onState: (online: boolean) => void };

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

  const flush = async () => {
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

  const handle = (event: { type: string; conn?: string; update?: string; peers?: number }) => {
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

/** Réglages d'une page partagée, vus par ce compte. */
export const shareInfo = (shareId: string) => post<{ owner: boolean; public: boolean }>(`share/${shareId}`, {});

/** Active ou coupe le lien public en lecture seule (propriétaire seulement). */
export const setSharePublic = (shareId: string, enabled: boolean) =>
  post<{ public: boolean }>(`share/${shareId}/public`, { public: enabled });

export async function publicLink(shareId: string) {
  return `${(await account()).server}/#/view/${shareId}`;
}
