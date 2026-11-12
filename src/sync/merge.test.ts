import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fromBase64, toBase64 } from "../util/base64";
import { mergeDocs } from "./merge";

const state = (doc: Y.Doc) => toBase64(Y.encodeStateAsUpdate(doc));
const text = (b64: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(b64));
  return doc.getText("t").toString();
};

describe("mergeDocs", () => {
  it("garde les modifications faites des deux côtés", () => {
    const base = new Y.Doc();
    base.getText("t").insert(0, "bonjour");
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    a.getText("t").insert(0, "A ");
    b.getText("t").insert(7, " B");
    const merged = mergeDocs(state(a), state(b))!;
    expect(text(merged)).toBe("A bonjour B");
    // La fusion donne le même texte dans les deux sens.
    expect(text(mergeDocs(state(b), state(a))!)).toBe("A bonjour B");
  });

  it("renvoie l'état local inchangé quand le distant n'apporte rien", () => {
    const old = new Y.Doc();
    old.getText("t").insert(0, "x");
    const newer = new Y.Doc();
    Y.applyUpdate(newer, Y.encodeStateAsUpdate(old));
    newer.getText("t").insert(1, "y");
    const local = state(newer);
    expect(mergeDocs(local, state(old))).toBe(local);
    expect(mergeDocs(local, null)).toBe(local);
    expect(mergeDocs(null, local)).toBe(local);
  });
});
