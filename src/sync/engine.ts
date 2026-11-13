import { db } from "../db";
import { SYNC_TABLES } from "../db/schema";
import type { SqlValue } from "../db/types";
import { useStore } from "../store";
import { mergeDocs } from "./merge";

type Row = Record<string, SqlValue>;
type Change = { tbl: string; id: string; data: Row | null; at: number };
type Statement = { sql: string; params?: SqlValue[] };
export type SyncState = {
  server: string | null;
  username: string | null;
  token: string | null;
  seq: number;
  last_sync: number | null;
};

/** Événement émis quand le contenu d'une page arrive d'un autre appareil. */
export const REMOTE_DOC_EVENT = "nautila-remote-doc";
const PUSH_ROWS = 40;
const PUSH_BYTES = 8 * 1024 * 1024;

export class SyncError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getSyncState(): Promise<SyncState> {
  const [state] = await db().all<SyncState>("SELECT server, username, token, seq, last_sync FROM sync_state");
  return state;
}

async function api<T>(server: string, path: string, body: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SyncError(0, "offline");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(res.status, json.error ?? `HTTP ${res.status}`);
  return json as T;
}

const where = (table: string) => SYNC_TABLES[table].map((k) => `${k} = ?`).join(" AND ");

/** Connecte cet appareil à un compte, puis met toutes les données locales en file d'envoi. */
export async function connect(input: {
  server: string;
  username: string;
  password: string;
  register: boolean;
  invite?: string;
}) {
  const server = input.server.trim().replace(/\/+$/, "");
  const res = await api<{ token: string; username: string }>(server, input.register ? "register" : "login", {
    username: input.username,
    password: input.password,
    invite: input.invite,
  });
  await db().run("UPDATE sync_state SET server = ?, username = ?, token = ?, seq = 0, last_sync = NULL", [
    server,
    res.username,
    res.token,
  ]);
  const now = Date.now();
  for (const [table, key] of Object.entries(SYNC_TABLES)) {
    // Les pages gardent leur date de modification, pour ne pas écraser une version plus récente du compte.
    const at = table === "pages" ? "updated_at" : String(now);
    await db().run(
      `INSERT OR IGNORE INTO sync_log (tbl, id, at) SELECT '${table}', ${key.join(" || '|' || ")}, ${at} FROM ${table}`,
    );
  }
  useStore.setState({ sync: { status: "idle", username: res.username } });
  await syncNow();
}

/** Crée un jeton pour le connecteur MCP ; renvoie l'adresse du connecteur et le jeton. */
export async function createAccessToken(): Promise<{ url: string; token: string }> {
  const state = await getSyncState();
  if (!state.server || !state.token) throw new SyncError(401, "auth");
  const { token } = await api<{ token: string }>(state.server, "token", {}, state.token);
  return { url: `${state.server}/mcp`, token };
}

export async function disconnect() {
  const state = await getSyncState();
  if (state.server && state.token) await api(state.server, "logout", {}, state.token).catch(() => undefined);
  await db().run("UPDATE sync_state SET token = NULL, seq = 0, last_sync = NULL");
  await db().run("DELETE FROM sync_log");
  useStore.setState({ sync: { status: "off" } });
}

const columns = new Map<string, Set<string>>();
async function knownColumns(table: string) {
  if (!columns.has(table)) {
    const info = await db().all<{ name: string }>(`PRAGMA table_info(${table})`);
    columns.set(table, new Set(info.map((c) => c.name)));
  }
  return columns.get(table)!;
}

async function upsert(table: string, data: Row): Promise<Statement> {
  // Une colonne inconnue (appareil plus récent) est ignorée plutôt que de bloquer la synchronisation.
  const known = await knownColumns(table);
  const cols = Object.keys(data).filter((c) => known.has(c));
  return {
    sql: `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    params: cols.map((c) => data[c]),
  };
}

const reindex = (id: string): Statement[] => [
  { sql: "DELETE FROM pages_fts WHERE page_id = ?", params: [id] },
  {
    sql: "INSERT INTO pages_fts (page_id, title, body) SELECT id, title, body FROM pages WHERE id = ? AND deleted_at IS NULL",
    params: [id],
  },
];

/** Applique des changements reçus du serveur, en une seule transaction. */
async function apply(changes: Change[]) {
  const writes: Statement[] = [];
  const log: Statement[] = [];
  const live: { id: string; ydoc: string }[] = [];

  for (const c of changes) {
    if (!SYNC_TABLES[c.tbl]) continue;
    const key = c.id.split("|");
    const [pending] = await db().all<{ at: number }>("SELECT at FROM sync_log WHERE tbl = ? AND id = ?", [c.tbl, c.id]);
    const localIsNewer = !!pending && pending.at > c.at;
    const unlog = { sql: "DELETE FROM sync_log WHERE tbl = ? AND id = ?", params: [c.tbl, c.id] };

    if (c.tbl === "pages" && c.data) {
      // Le contenu d'une page est toujours fusionné ; les autres champs suivent la règle du plus récent.
      const [local] = await db().all<{ ydoc: string | null }>("SELECT ydoc FROM pages WHERE id = ?", [c.id]);
      const remoteDoc = (c.data.ydoc as string | null) ?? null;
      const merged = mergeDocs(local?.ydoc ?? null, remoteDoc);
      if (localIsNewer) {
        if (merged !== local?.ydoc)
          writes.push({ sql: "UPDATE pages SET ydoc = ? WHERE id = ?", params: [merged, c.id] });
      } else {
        writes.push(await upsert("pages", { ...c.data, ydoc: merged }));
        // La fusion contient des modifications locales que le serveur n'a pas : elle repart vers lui.
        log.push(
          merged === remoteDoc
            ? unlog
            : {
                sql: "INSERT OR REPLACE INTO sync_log (tbl, id, at) VALUES ('pages', ?, ?)",
                params: [c.id, Date.now()],
              },
        );
      }
      writes.push(...reindex(c.id));
      if (local && remoteDoc && merged !== local.ydoc) live.push({ id: c.id, ydoc: remoteDoc });
      continue;
    }

    if (localIsNewer) continue;
    if (c.data === null) {
      writes.push({ sql: `DELETE FROM ${c.tbl} WHERE ${where(c.tbl)}`, params: key });
      if (c.tbl === "pages") writes.push({ sql: "DELETE FROM pages_fts WHERE page_id = ?", params: [c.id] });
    } else writes.push(await upsert(c.tbl, c.data));
    log.push(unlog);
  }

  await db().batch([
    { sql: "UPDATE sync_state SET applying = 1" },
    ...writes,
    { sql: "UPDATE sync_state SET applying = 0" },
    ...log,
  ]);
  for (const detail of live) window.dispatchEvent(new CustomEvent(REMOTE_DOC_EVENT, { detail }));
}

async function cycle() {
  const state = await getSyncState();
  if (!state.server || !state.token) return;
  const { sync } = useStore.getState();
  useStore.setState({ sync: { ...sync, status: "syncing", username: state.username ?? undefined } });
  try {
    let seq = state.seq;
    let received = false;
    for (let round = 0; round < 500; round++) {
      const pending = await db().all<{ tbl: string; id: string; at: number }>(
        `SELECT tbl, id, at FROM sync_log ORDER BY at LIMIT ${PUSH_ROWS}`,
      );
      const changes: Change[] = [];
      let bytes = 0;
      for (const p of pending) {
        const [data] = await db().all<Row>(`SELECT * FROM ${p.tbl} WHERE ${where(p.tbl)}`, p.id.split("|"));
        const size = data ? JSON.stringify(data).length : 0;
        if (changes.length > 0 && bytes + size > PUSH_BYTES) break;
        bytes += size;
        changes.push({ ...p, data: data ?? null });
      }

      const res = await api<{ seq: number; changes: Change[]; more: boolean }>(
        state.server,
        "sync",
        { since: seq, changes },
        state.token,
      );
      // Une ligne remodifiée pendant l'envoi a une date plus récente : elle reste en file.
      for (const c of changes)
        await db().run("DELETE FROM sync_log WHERE tbl = ? AND id = ? AND at = ?", [c.tbl, c.id, c.at]);
      if (res.changes.length > 0) {
        await apply(res.changes);
        received = true;
      }
      seq = res.seq;
      await db().run("UPDATE sync_state SET seq = ?, last_sync = ?", [seq, Date.now()]);
      if (!res.more && changes.length === pending.length && pending.length < PUSH_ROWS) break;
    }
    // Pages partagées : les modifications des autres participants arrivent même page fermée.
    try {
      const { syncSharedPages } = await import("./share");
      if (await syncSharedPages()) received = true;
    } catch (err) {
      console.warn("Pages partagées non synchronisées :", err);
    }
    if (received) {
      await useStore.getState().refreshPages();
      await useStore.getState().refreshDue();
    }
    useStore.setState({ sync: { status: "idle", username: state.username ?? undefined, lastSync: Date.now() } });
  } catch (err) {
    const error =
      err instanceof SyncError
        ? err.status === 401
          ? "auth"
          : err.status === 413
            ? "quota"
            : err.status === 0
              ? "offline"
              : err.message
        : String(err);
    useStore.setState({ sync: { status: "error", username: state.username ?? undefined, error } });
  }
}

let running: Promise<void> | null = null;
/** Lance une synchronisation, ou rejoint celle en cours. */
export function syncNow(): Promise<void> {
  return (running ??= cycle().finally(() => (running = null)));
}

/** Synchronise en arrière-plan : vite après une modification locale, sinon à intervalle régulier. */
export async function startSync() {
  const state = await getSyncState();
  if (state.token)
    useStore.setState({
      sync: { status: "idle", username: state.username ?? undefined, lastSync: state.last_sync ?? undefined },
    });
  let lastPull = 0;
  const tick = async () => {
    if (useStore.getState().sync.status === "off" || document.visibilityState === "hidden") return;
    const [{ n }] = await db().all<{ n: number }>("SELECT COUNT(*) AS n FROM sync_log");
    if (n === 0 && Date.now() - lastPull < 25_000) return;
    lastPull = Date.now();
    await syncNow();
  };
  setInterval(() => void tick(), 6_000);
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void tick());
  void tick();
}
