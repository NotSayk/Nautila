import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le serveur est simulé : seules les requêtes envoyées et le détachement local sont observés.
const updatePageMeta = vi.fn(async () => undefined);
vi.mock("../data/pages", () => ({ updatePageMeta, createPage: vi.fn() }));
vi.mock("../db", () => ({ db: () => ({ all: async () => [], run: async () => undefined }) }));
vi.mock("./engine", () => {
  class SyncError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { SyncError, REMOTE_DOC_EVENT: "remote", getSyncState: async () => ({ server: "http://srv", token: "t" }) };
});

const { joinShare, leaveShare, regenerateInvite } = await import("./share");
const ID = "ABCDEFGHIJKLMNOPQRSTUV";
let calls: string[] = [];
let reply: () => Promise<Response>;

beforeEach(() => {
  calls = [];
  updatePageMeta.mockClear();
  reply = async () => new Response("{}", { status: 200 });
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return reply();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("quitter une page partagée", () => {
  it("retire le participant sur le serveur, puis détache la page", async () => {
    await leaveShare("p1", ID, false);
    expect(calls).toEqual([`http://srv/api/share/${ID}/leave`]);
    expect(updatePageMeta).toHaveBeenCalledWith("p1", { share_id: null });
  });

  it("arrête le partage pour tous quand c'est le propriétaire", async () => {
    await leaveShare("p1", ID, true);
    expect(calls).toEqual([`http://srv/api/share/${ID}/delete`]);
  });

  it("ne détache rien hors connexion", async () => {
    reply = async () => {
      throw new TypeError("offline");
    };
    await expect(leaveShare("p1", ID, false)).rejects.toThrow();
    expect(updatePageMeta).not.toHaveBeenCalled();
  });

  it("détache quand même avec un serveur plus ancien, sans route « leave »", async () => {
    reply = async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    await leaveShare("p1", ID, false);
    expect(updatePageMeta).toHaveBeenCalled();
  });
});

describe("liens de partage", () => {
  it("régénère le secret d'invitation", async () => {
    reply = async () => new Response(JSON.stringify({ invite: "x".repeat(22) }), { status: 200 });
    expect(await regenerateInvite(ID)).toEqual({ invite: "x".repeat(22) });
    expect(calls).toEqual([`http://srv/api/share/${ID}/invite`]);
  });

  it("n'appelle jamais le serveur avec un identifiant forgé", async () => {
    await expect(joinShare(`${ID}\\delete`)).rejects.toThrow();
    await expect(joinShare("%2e%2e\\logout")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
