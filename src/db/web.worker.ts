/// <reference lib="webworker" />
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";

type Req = { id: number; sql: string; params: (string | number | null)[]; rows: boolean };

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
  const { id, sql, params, rows } = e.data;
  try {
    await ready;
    const result = rows
      ? db.exec({ sql, bind: params, rowMode: "object", returnValue: "resultRows" })
      : void db.exec(sql, { bind: params });
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
