import * as Y from "yjs";
import { fromBase64, toBase64 } from "../util/base64";

/**
 * Fusionne deux états Yjs (base64). Renvoie `local` tel quel quand `remote`
 * n'apporte rien, ce qui permet de savoir si la fusion a changé quelque chose.
 */
export function mergeDocs(local: string | null, remote: string | null): string | null {
  if (!remote || remote === local) return local;
  if (!local) return remote;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(local));
  const before = toBase64(Y.encodeStateAsUpdate(doc));
  Y.applyUpdate(doc, fromBase64(remote));
  const after = toBase64(Y.encodeStateAsUpdate(doc));
  return after === before ? local : after;
}
