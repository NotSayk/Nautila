import { useEffect, useState } from "react";
import { isTauri } from "../db";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import { connect, createAccessToken, disconnect, getSyncState, SyncError, syncNow } from "../sync/engine";
import { relativeTime, useOverlay } from "./common";

const FIELD = "mt-1 h-8 w-full rounded-md bg-hover px-2 text-sm text-ink placeholder:text-faint";

/** Message lisible pour une erreur du serveur ou du réseau. */
function errorKey(error: string | undefined): Key {
  const map: Record<string, Key> = {
    offline: "errOffline",
    auth: "errAuth",
    quota: "errQuota",
    "bad credentials": "errCredentials",
    "username taken": "errTaken",
    "invalid invite": "errInvite",
    "registration closed": "errInvite",
    "invalid username": "errUsername",
    "invalid password": "errPassword",
    "too many attempts": "errTooMany",
  };
  return map[error ?? ""] ?? "errUnknown";
}

export function SyncDialog() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const sync = useStore((s) => s.sync);
  const close = () => useStore.setState({ syncOpen: false });
  useOverlay(close);
  // Hébergée, l'application propose par défaut son propre serveur.
  const [server, setServer] = useState(isTauri() || location.hostname === "localhost" ? "" : location.origin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [mcp, setMcp] = useState<{ url: string; token: string } | null>(null);

  useEffect(() => {
    getSyncState().then((state) => {
      if (state.server) setServer(state.server);
      if (state.username) setUsername(state.username);
    });
  }, []);

  const submit = async (register: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await connect({ server, username, password, register, invite: invite || undefined });
      setPassword("");
    } catch (err) {
      setError(err instanceof SyncError ? (err.status === 0 ? "offline" : err.message) : String(err));
    }
    setBusy(false);
  };

  const connected = sync.status !== "off";
  const failure = connected ? (sync.status === "error" ? sync.error : undefined) : error;
  const button = "h-8 rounded-md px-3 font-medium disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("syncTitle")}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-pop p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <p className="text-base font-semibold">{t("syncTitle")}</p>
        {connected ? (
          <>
            <p className="mt-3">
              {t("syncConnected")} <span className="font-medium">{sync.username}</span>
            </p>
            <p className="mt-1 text-muted">
              {sync.status === "syncing"
                ? t("syncing")
                : `${t("syncLast")} : ${sync.lastSync ? relativeTime(sync.lastSync, lang) : t("syncNever")}`}
            </p>
            {failure && (
              <p className="mt-3 text-danger">
                {t(errorKey(failure))}
                {errorKey(failure) === "errUnknown" ? ` : ${failure}` : ""}
              </p>
            )}
            <div className="mt-5 pt-4 shadow-[inset_0_1px_0_var(--color-line)]">
              <p className="font-medium">{t("mcpTitle")}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{t("mcpIntro")}</p>
              {mcp ? (
                <>
                  <p className="mt-2 text-[13px] text-danger">{t("mcpShownOnce")}</p>
                  {[
                    [
                      "Claude Code",
                      `claude mcp add --transport http nautila ${mcp.url} --header "Authorization: Bearer ${mcp.token}"`,
                    ],
                    [
                      "Codex (~/.codex/config.toml)",
                      `[mcp_servers.nautila]\nurl = "${mcp.url}"\nbearer_token_env_var = "NAUTILA_TOKEN"\n# export NAUTILA_TOKEN=${mcp.token}`,
                    ],
                    ["claude.ai", `${mcp.url}/${mcp.token}`],
                  ].map(([label, text]) => (
                    <label key={label} className="mt-2 block text-xs text-muted">
                      {label}
                      <textarea
                        readOnly
                        rows={label.startsWith("Codex") ? 4 : 2}
                        value={text}
                        onFocus={(e) => e.currentTarget.select()}
                        className="mt-1 w-full resize-none rounded-md bg-hover p-2 font-mono text-[11px] leading-4 text-ink"
                      />
                    </label>
                  ))}
                </>
              ) : (
                <button
                  className={`${button} mt-2 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover`}
                  onClick={async () => setMcp(await createAccessToken().catch(() => null))}
                >
                  {t("mcpCreate")}
                </button>
              )}
            </div>
            <div className="mt-5 flex justify-between gap-2">
              <button className={`${button} text-danger hover:bg-hover`} onClick={() => disconnect()}>
                {t("logout")}
              </button>
              <button
                className={`${button} bg-accent text-white hover:brightness-95`}
                disabled={sync.status === "syncing"}
                onClick={() => syncNow()}
              >
                {t("syncNow")}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(false);
            }}
          >
            <p className="mt-2 text-[13px] leading-5 text-muted">{t("syncIntro")}</p>
            <label className="mt-3 block text-xs text-muted">
              {t("serverUrl")}
              <input
                required
                type="url"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://notes.example.org"
                className={FIELD}
              />
            </label>
            <label className="mt-2 block text-xs text-muted">
              {t("username")}
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="mt-2 block text-xs text-muted">
              {t("password")}
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="mt-2 block text-xs text-muted">
              {t("inviteCode")}
              <input value={invite} onChange={(e) => setInvite(e.target.value)} className={FIELD} />
            </label>
            {failure && (
              <p className="mt-3 text-danger">
                {t(errorKey(failure))}
                {errorKey(failure) === "errUnknown" ? ` : ${failure}` : ""}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy || !server || !username || !password}
                className={`${button} hover:bg-hover`}
                onClick={() => submit(true)}
              >
                {t("createAccount")}
              </button>
              <button disabled={busy} className={`${button} bg-accent text-white hover:brightness-95`}>
                {t("login")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
