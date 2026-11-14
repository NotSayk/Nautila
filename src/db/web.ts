import type { Db, SqlValue } from "./types";

export async function openWebDb(): Promise<Db> {
  const worker = new Worker(new URL("./web.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  const status = await new Promise<{ persistent: boolean; blockedByOtherTab: boolean }>((resolve, reject) => {
    worker.onmessage = (e) => {
      const msg = e.data;
      if ("ready" in msg) {
        if (msg.ready) resolve({ persistent: msg.persistent, blockedByOtherTab: msg.blockedByOtherTab === true });
        else reject(new Error(msg.error));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.result);
    };
    worker.onerror = (e) => reject(new Error(e.message));
  });

  const post = (message: object) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...message });
    });

  return {
    persistent: status.persistent,
    blockedByOtherTab: status.blockedByOtherTab,
    run: async (sql, params = []) => void (await post({ sql, params, rows: false })),
    all: async <T>(sql: string, params: SqlValue[] = []) => (await post({ sql, params, rows: true })) as T[],
    batch: async (batch) => void (await post({ batch })),
  };
}
