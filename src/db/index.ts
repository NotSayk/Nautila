import { migrate } from "./schema";
import type { Db } from "./types";

let instance: Db | undefined;

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function initDb(): Promise<Db> {
  const db = isTauri() ? await (await import("./tauri")).openTauriDb() : await (await import("./web")).openWebDb();
  await migrate(db);
  instance = db;
  return db;
}

export function db(): Db {
  if (!instance) throw new Error("Base de données non initialisée");
  return instance;
}

/** Remplace la base (tests). */
export function setDb(d: Db) {
  instance = d;
}
