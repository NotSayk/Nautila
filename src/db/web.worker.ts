/// <reference lib="webworker" />
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";

type Param = string | number | null;
type Req =
  | { id: number; sql: string; params: Param[]; rows: boolean }
  | { id: number; batch: { sql: string; params?: Param[] }[] };

let db: Database;

async function open(): Promise<boolean> {
  const sqlite3 = await sqlite3InitModule();
  try {
    // OPFS « SAH pool » : persistant, et ne demande pas d'en-têtes COOP/COEP.
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "nautila" });
    db = new pool.OpfsSAHPoolDb("/nautila.db");
    return true;
  } catch (err) {
    console.warn("Stockage persistant indisponible, base en mémoire :", err);
    db = new sqlite3.oo1.DB(":memory:");
    return false;
  }
}

const ready = open();
ready.then(
  (persistent) => postMessage({ ready: true, persistent }),
  (err) => postMessage({ ready: false, error: String(err) }),
);

onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    await ready;
    let result: unknown;
    if ("batch" in req) db.transaction(() => req.batch.forEach((s) => db.exec(s.sql, { bind: s.params ?? [] })));
    else if (req.rows)
      result = db.exec({ sql: req.sql, bind: req.params, rowMode: "object", returnValue: "resultRows" });
    else db.exec(req.sql, { bind: req.params });
    postMessage({ id: req.id, result });
  } catch (err) {
    postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
