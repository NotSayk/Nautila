/// <reference lib="webworker" />
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";

type Param = string | number | null;
type Req =
  | { id: number; sql: string; params: Param[]; rows: boolean }
  | { id: number; batch: { sql: string; params?: Param[] }[] };

let db: Database;

const LOCK_NAME = "nautila-db";
/** Le stockage persistant n'admet qu'un seul onglet ; on laisse le temps à un onglet qui se ferme ou se recharge. */
const ATTEMPTS = 6;
const RETRY_MS = 500;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Prend un verrou tenu aussi longtemps que ce worker vit : false si un autre onglet le tient déjà. */
function takeLock(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise<void>(() => undefined) : undefined;
    });
  });
}

/** L'erreur d'OPFS quand un autre onglet tient déjà les poignées d'accès aux fichiers de la base. */
const isBusyError = (err: unknown) =>
  err instanceof Error &&
  (err.name === "NoModificationAllowedError" || /access handle|another open|already open/i.test(err.message));

async function open(): Promise<{ persistent: boolean; blockedByOtherTab: boolean }> {
  const sqlite3 = await sqlite3InitModule();
  let blocked = false;
  let locked = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    locked ||= await takeLock();
    if (!locked) {
      blocked = true;
    } else {
      try {
        // OPFS « SAH pool » : persistant, et ne demande pas d'en-têtes COOP/COEP.
        const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "nautila" });
        db = new pool.OpfsSAHPoolDb("/nautila.db");
        return { persistent: true, blockedByOtherTab: false };
      } catch (err) {
        blocked = isBusyError(err);
        if (!blocked) {
          console.warn("Stockage persistant indisponible, base en mémoire :", err);
          break;
        }
      }
    }
    if (attempt < ATTEMPTS - 1) await wait(RETRY_MS);
  }
  if (blocked) console.warn("Nautila est déjà ouvert dans un autre onglet : base en mémoire, sans persistance.");
  db = new sqlite3.oo1.DB(":memory:");
  return { persistent: false, blockedByOtherTab: blocked };
}

const ready = open();
ready.then(
  (status) => postMessage({ ready: true, ...status }),
  (err) => postMessage({ ready: false, error: String(err) }),
);

onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    await ready;
    let result: unknown;
    // db.transaction : BEGIN, puis COMMIT, ou ROLLBACK si une instruction échoue.
    if ("batch" in req) db.transaction(() => req.batch.forEach((s) => db.exec(s.sql, { bind: s.params ?? [] })));
    else if (req.rows)
      result = db.exec({ sql: req.sql, bind: req.params, rowMode: "object", returnValue: "resultRows" });
    else db.exec(req.sql, { bind: req.params });
    postMessage({ id: req.id, result });
  } catch (err) {
    postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
