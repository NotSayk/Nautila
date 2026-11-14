import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mismatches,
  readCargoToml,
  readVersions,
  setCargoLock,
  setCargoToml,
  setJson,
  setVersion,
} from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("version de l'application", () => {
  it("est la même dans package.json, tauri.conf.json et Cargo.toml", () => {
    // Échoue si l'on a changé un numéro à la main sans les autres : utiliser `npm run version:set`.
    expect(mismatches(readVersions(root))).toEqual([]);
  });

  it("signale les fichiers qui ne correspondent pas à l'étiquette", () => {
    const versions = { a: "0.3.0", b: "0.2.5", c: undefined };
    expect(mismatches(versions, "v0.3.0")).toEqual(["b : 0.2.5 (attendu 0.3.0)", "c : introuvable (attendu 0.3.0)"]);
    expect(mismatches({ a: "1.0.0", b: "1.0.0" }, "v1.0.0")).toEqual([]);
    expect(mismatches({ a: "1.0.0", b: "1.0.1" })).toHaveLength(1);
  });
});

describe("réécriture de la version", () => {
  it("ne touche que la version de Cargo.toml", () => {
    const toml = '[package]\nname = "x"\nversion = "0.2.5"\n\n[dependencies]\ntauri = { version = "2" }\n';
    const out = setCargoToml(toml, "0.3.0");
    expect(readCargoToml(out)).toBe("0.3.0");
    expect(out).toContain('tauri = { version = "2" }');
  });

  it("ne change que le paquet nautila dans Cargo.lock", () => {
    const lock = '[[package]]\nname = "autre"\nversion = "1.0.0"\n\n[[package]]\nname = "nautila"\nversion = "0.2.5"\n';
    const out = setCargoLock(lock, "0.3.0");
    expect(out).toContain('name = "autre"\nversion = "1.0.0"');
    expect(out).toContain('name = "nautila"\nversion = "0.3.0"');
  });

  it("met aussi à jour le paquet racine de package-lock.json", () => {
    const out = JSON.parse(setJson('{"version":"0.2.5","packages":{"":{"version":"0.2.5"}}}\n', "0.3.0", true));
    expect(out.version).toBe("0.3.0");
    expect(out.packages[""].version).toBe("0.3.0");
  });

  it("écrit la nouvelle version partout et refuse une version invalide", () => {
    const dir = mkdtempSync(join(tmpdir(), "nautila-version-"));
    try {
      mkdirSync(join(dir, "src-tauri"));
      for (const f of [
        "package.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
      ])
        cpSync(join(root, f), join(dir, f));
      expect(() => setVersion(dir, "trois")).toThrow();
      setVersion(dir, "9.8.7");
      expect(mismatches(readVersions(dir), "v9.8.7")).toEqual([]);
      expect(readFileSync(join(dir, "src-tauri/Cargo.lock"), "utf8")).toMatch(/name = "nautila"\r?\nversion = "9.8.7"/);
      expect(JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8")).packages[""].version).toBe("9.8.7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
