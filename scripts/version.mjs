// Numéro de version de Nautila : il vit dans package.json, src-tauri/tauri.conf.json et
// src-tauri/Cargo.toml (plus les deux fichiers de verrouillage). Ce script les garde d'accord.
//
//   npm run version:set -- 0.3.0            met tout à jour
//   node scripts/version.mjs check v0.3.0   échoue si un fichier ne correspond pas (étiquette de release)
//   node scripts/version.mjs check          échoue si les fichiers ne s'accordent pas entre eux
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Remplace la version de Cargo.toml (première ligne `version = "…"`, celle de `[package]`). */
export function setCargoToml(text, version) {
  return text.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

export function readCargoToml(text) {
  return /^version = "([^"]*)"/m.exec(text)?.[1];
}

/** Dans Cargo.lock, seule l'entrée du paquet `nautila` change. */
export function setCargoLock(text, version) {
  return text.replace(/(\[\[package\]\]\r?\nname = "nautila"\r?\nversion = ")[^"]*(")/, `$1${version}$2`);
}

/** Remplace la version d'un fichier JSON (pour package-lock.json, aussi celle du paquet racine). */
export function setJson(text, version, lock = false) {
  const data = JSON.parse(text);
  data.version = version;
  if (lock && data.packages?.[""]) data.packages[""].version = version;
  return JSON.stringify(data, null, 2) + (text.endsWith("\n") ? "\n" : "");
}

const files = (root) => ({
  pkg: join(root, "package.json"),
  lock: join(root, "package-lock.json"),
  tauri: join(root, "src-tauri", "tauri.conf.json"),
  cargo: join(root, "src-tauri", "Cargo.toml"),
  cargoLock: join(root, "src-tauri", "Cargo.lock"),
});

/** Les versions lues dans les trois fichiers de référence. */
export function readVersions(root) {
  const f = files(root);
  return {
    "package.json": JSON.parse(readFileSync(f.pkg, "utf8")).version,
    "src-tauri/tauri.conf.json": JSON.parse(readFileSync(f.tauri, "utf8")).version,
    "src-tauri/Cargo.toml": readCargoToml(readFileSync(f.cargo, "utf8")),
  };
}

export function setVersion(root, version) {
  if (!SEMVER.test(version)) throw new Error(`Version invalide : « ${version} » (attendu : 1.2.3).`);
  const f = files(root);
  const edit = (path, fn) => writeFileSync(path, fn(readFileSync(path, "utf8")));
  edit(f.pkg, (t) => setJson(t, version));
  edit(f.lock, (t) => setJson(t, version, true));
  edit(f.tauri, (t) => setJson(t, version));
  edit(f.cargo, (t) => setCargoToml(t, version));
  edit(f.cargoLock, (t) => setCargoLock(t, version));
}

/** Liste des écarts ; vide si tout est d'accord (et avec l'étiquette `v…` si elle est donnée). */
export function mismatches(versions, tag) {
  const wanted = tag === undefined ? Object.values(versions)[0] : tag.replace(/^v/, "");
  return Object.entries(versions)
    .filter(([, v]) => v !== wanted)
    .map(([file, v]) => `${file} : ${v ?? "introuvable"} (attendu ${wanted})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === "set" && arg) {
      const version = arg.replace(/^v/, "");
      setVersion(root, version);
      console.log(`Version ${version} écrite dans package.json, tauri.conf.json, Cargo.toml et les verrous.`);
    } else if (command === "check") {
      const bad = mismatches(readVersions(root), arg);
      if (bad.length) {
        console.error(`Versions incohérentes :\n- ${bad.join("\n- ")}`);
        process.exit(1);
      }
      console.log("Versions cohérentes.");
    } else {
      console.error("Usage : npm run version:set -- 0.3.0   |   node scripts/version.mjs check [v0.3.0]");
      process.exit(2);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
