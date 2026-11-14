import { beforeEach, describe, expect, it, vi } from "vitest";

// Le store principal touche au navigateur à sa création : on le remplace par un faux minimal.
const app = vi.hoisted(() => ({ state: { lang: "fr", toast: null as { message: string } | null } }));
vi.mock("../store", () => ({
  useStore: { getState: () => app.state, setState: (patch: object) => Object.assign(app.state, patch) },
}));

const plugin = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: plugin.check }));

import { checkForUpdates, dismissUpdate, installUpdate, useUpdate } from "./updater";

const initial = useUpdate.getState();

function fakeUpdate(download: (cb: (e: object) => void) => Promise<void>) {
  return { version: "0.3.0", body: "Notes", close: vi.fn(async () => {}), downloadAndInstall: vi.fn(download) };
}

beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  useUpdate.setState(initial, true);
  app.state.toast = null;
  plugin.check.mockReset();
});

describe("vérification des mises à jour", () => {
  it("ne fait rien hors de l'app de bureau", async () => {
    vi.stubGlobal("window", {});
    await checkForUpdates(true);
    expect(plugin.check).not.toHaveBeenCalled();
  });

  it("propose la nouvelle version sans message pour une vérification automatique", async () => {
    plugin.check.mockResolvedValue(fakeUpdate(async () => {}));
    await checkForUpdates();
    expect(useUpdate.getState().found).toEqual({ version: "0.3.0", notes: "Notes" });
    expect(useUpdate.getState().phase).toBe("available");
    expect(app.state.toast).toBeNull();
  });

  it("reste silencieuse en cas d'erreur automatique, mais prévient en cas d'erreur manuelle", async () => {
    plugin.check.mockRejectedValue(new Error("hors ligne"));
    await checkForUpdates();
    expect(app.state.toast).toBeNull();
    await checkForUpdates(true);
    expect(app.state.toast?.message).toMatch(/Impossible de vérifier/);
    expect(useUpdate.getState().checking).toBe(false);
  });

  it("dit que Nautila est à jour après une recherche manuelle", async () => {
    plugin.check.mockResolvedValue(null);
    await checkForUpdates(true);
    expect(app.state.toast?.message).toBe("Nautila est à jour");
    expect(useUpdate.getState().phase).toBe("idle");
  });

  it("« Plus tard » écarte la version, qu'une recherche manuelle remet en avant", async () => {
    plugin.check.mockResolvedValue(fakeUpdate(async () => {}));
    await checkForUpdates();
    dismissUpdate();
    expect(useUpdate.getState().dismissed).toBe("0.3.0");
    await checkForUpdates(true);
    expect(useUpdate.getState().dismissed).toBeNull();
    expect(app.state.toast?.message).toBe("Nautila 0.3.0 est disponible");
  });
});

describe("installation", () => {
  it("suit la progression puis passe à « prête »", async () => {
    const seen: number[] = [];
    plugin.check.mockResolvedValue(
      fakeUpdate(async (cb) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 40 } });
        seen.push(useUpdate.getState().downloaded);
        cb({ event: "Progress", data: { chunkLength: 60 } });
        cb({ event: "Finished" });
      }),
    );
    await checkForUpdates();
    await installUpdate();
    expect(seen).toEqual([40]);
    expect(useUpdate.getState()).toMatchObject({ phase: "ready", downloaded: 100, total: 100 });
  });

  it("revient à « disponible » avec une erreur si le téléchargement échoue", async () => {
    plugin.check.mockResolvedValue(
      fakeUpdate(async () => {
        throw new Error("signature invalide");
      }),
    );
    await checkForUpdates();
    await installUpdate();
    expect(useUpdate.getState()).toMatchObject({ phase: "available", installFailed: true });
  });
});
