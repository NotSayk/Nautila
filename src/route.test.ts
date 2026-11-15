import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "./route";
import { parseShareLink, sharePath, validFileId } from "./sync/ids";

const ID = "ABCDEFGHIJKLMNOPQRSTUV";
const SECRET = "abcdefghijklmnopqrstuv";
const bs = String.fromCharCode(92);

describe("liens de partage", () => {
  it("lit les liens d'invitation et de page publique", () => {
    expect(parseRoute(`#/join/${ID}`)).toEqual({ view: "join", id: ID });
    expect(parseRoute(`#/join/${ID}/${SECRET}`)).toEqual({ view: "join", id: ID, invite: SECRET });
    expect(parseRoute(`#/view/${ID}`)).toEqual({ view: "view", id: ID });
    expect(routeHash({ view: "join", id: ID, invite: SECRET })).toBe(`/join/${ID}/${SECRET}`);
    expect(parseRoute(`#${routeHash({ view: "join", id: ID, invite: SECRET })}`)).toEqual({ view: "join", id: ID, invite: SECRET });
  });

  it("ramène à l'accueil un identifiant forgé", () => {
    for (const hash of [
      `#/join/${ID}${bs}delete`,
      `#/join/%2e%2e${bs}logout-others`,
      `#/join/${ID}%2F..%2Flogout`,
      `#/view/${ID}${bs}..${bs}token`,
      `#/join/${ID}/${SECRET}/delete`,
      `#/join/${ID}/..`,
      `#/view/${ID}/${SECRET}`,
      "#/join/court",
      "#/join/",
    ])
      expect(parseRoute(hash), hash).toEqual({ view: "home" });
  });

  it("refuse de construire un chemin d'API à partir d'un identifiant invalide", () => {
    expect(sharePath(ID, "stream")).toBe(`share/${ID}/stream`);
    expect(() => sharePath(`${ID}${bs}delete`)).toThrow();
    expect(() => sharePath("../logout")).toThrow();
    expect(validFileId("aaaaaaaa-0000-4000-8000-000000000001")).toBe(true);
    expect(validFileId(`x${bs}..`)).toBe(false);
  });

  it("accepte le lien complet ou le code seul", () => {
    expect(parseShareLink(`https://srv.example/#/join/${ID}/${SECRET}`)).toEqual({ id: ID, invite: SECRET });
    expect(parseShareLink(`  ${ID}  `)).toEqual({ id: ID });
    expect(parseShareLink(`https://srv.example/#/join/${ID}${bs}delete`)).toBeNull();
  });
});
