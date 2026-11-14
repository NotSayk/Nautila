import { useEffect, useState } from "react";
import { isTauri } from "../db";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import {
  changePassword,
  connect,
  createAccessToken,
  disconnect,
  getSyncState,
  listAccessTokens,
  logoutOtherDevices,
  retrySkipped,
  revokeAccessToken,
  SyncError,
  syncNow,
  type AccessToken,
} from "../sync/engine";
import { relativeTime, useOverlay } from "./common";

const FIELD = "mt-1 h-8 w-full rounded-md bg-hover px-2 text-sm text-ink placeholder:text-faint";
const BUTTON = "h-8 rounded-md px-3 font-medium disabled:opacity-40";
const OUTLINE = `${BUTTON} shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover`;
const SECTION = "mt-5 pt-4 shadow-[inset_0_1px_0_var(--color-line)]";

/** Message lisible pour une erreur du serveur ou du réseau. */
function errorKey(error: string | undefined): Key {
  const map: Record<string, Key> = {
    offline: "errOffline",
    auth: "errAuth",
    quota: "errQuota",
    skipped: "errSkipped",
    "quota exceeded": "errQuota",
    "bad credentials": "errCredentials",
    "username taken": "errTaken",
    "invalid invite": "errInvite",
    "registration closed": "errInvite",
    "invalid username": "errUsername",
    "invalid password": "errPassword",
    "weak password": "errWeakPassword",
    "too many attempts": "errTooMany",
  };
  return map[error ?? ""] ?? "errUnknown";
}

const reason = (err: unknown) => (err instanceof SyncError ? (err.status === 0 ? "offline" : err.message) : String(err));

function ErrorText({ error, override }: { error: string; override?: Partial<Record<string, Key>> }) {
  const t = useT();
  const key = override?.[error] ?? errorKey(error);
  return (
    <p className="mt-2 text-[13px] text-danger">
      {t(key)}
      {key === "errUnknown" ? ` : ${error}` : ""}
    </p>
  );
}

/** Changer le mot de passe, et fermer les sessions des autres appareils. */
function AccountSecurity() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setNotice(await action());
    } catch (err) {
      setError(reason(err));
    }
    setBusy(false);
  };

  return (
    <div className={SECTION}>
      <p className="font-medium">{t("accountSecurity")}</p>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await changePassword(current, next);
              setCurrent("");
              setNext("");
              setOpen(false);
              return t("passwordChanged");
            });
          }}
        >
          <label className="mt-2 block text-xs text-muted">
            {t("currentPassword")}
            <input
              required
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="mt-2 block text-xs text-muted">
            {t("newPassword")}
            <input
              required
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={FIELD}
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={`${BUTTON} hover:bg-hover`} onClick={() => setOpen(false)}>
              {t("cancel")}
            </button>
            <button disabled={busy || !current || next.length < 8} className={`${BUTTON} bg-accent text-white`}>
              {t("changePassword")}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={OUTLINE} onClick={() => setOpen(true)}>
            {t("changePassword")}
          </button>
          <button
            className={OUTLINE}
            disabled={busy}
            onClick={() =>
              run(async () => `${t("logoutOthersDone")} ${(await logoutOtherDevices()).revoked}`)
            }
          >
            {t("logoutOthers")}
          </button>
        </div>
      )}
      {notice && <p className="mt-2 text-[13px] text-muted">{notice}</p>}
      {error && <ErrorText error={error} override={{ "bad credentials": "errCurrentPassword" }} />}
    </div>
  );
}

/** Jetons du connecteur MCP : création (affiché une seule fois), liste et révocation. */
function McpTokens() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [mcp, setMcp] = useState<{ url: string; token: string } | null>(null);
  const [tokens, setTokens] = useState<AccessToken[]>();
  const [error, setError] = useState<string>();

  const refresh = () =>
    listAccessTokens().then(
      (list) => setTokens(list),
      // Serveur plus ancien, sans liste des jetons : la section reste simplement vide.
      () => setTokens(undefined),
    );
  useEffect(() => void refresh(), []);

  const act = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(reason(err));
    }
    await refresh();
  };

  return (
    <div className={SECTION}>
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
            // claude.ai n'accepte pas d'en-tête : le jeton est dans l'adresse.
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
          className={`${OUTLINE} mt-2`}
          onClick={() =>
            act(async () => {
              setMcp(await createAccessToken());
            })
          }
        >
          {t("mcpCreate")}
        </button>
      )}
      {tokens && (
        <>
          <p className="mt-3 text-xs font-medium text-muted">{t("mcpTokens")}</p>
          {tokens.length === 0 ? (
            <p className="mt-1 text-[13px] text-muted">{t("mcpNoTokens")}</p>
          ) : (
            <ul className="mt-1 max-h-40 overflow-y-auto">
              {tokens.map((token) => (
                <li key={token.id} className="flex min-h-9 items-center justify-between gap-3 text-[13px]">
                  <span className="truncate text-muted">
                    {t("mcpTokenCreated")} {relativeTime(token.created_at, lang)}
                    {token.last_used && token.last_used - token.created_at > 60_000
                      ? ` · ${t("mcpTokenUsed")} ${relativeTime(token.last_used, lang)}`
                      : ""}
                  </span>
                  <button
                    className={`${BUTTON} shrink-0 text-danger hover:bg-hover`}
                    onClick={() => act(() => revokeAccessToken(token.id))}
                  >
                    {t("mcpRevoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <ErrorText error={error} />}
    </div>
  );
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
      setError(reason(err));
    }
    setBusy(false);
  };

  const connected = sync.status !== "off";
  const failure = connected ? (sync.status === "error" ? sync.error : undefined) : error;
  const button = BUTTON;

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
            {failure === "skipped" && (
              <button className={`${OUTLINE} mt-2`} disabled={sync.status === "syncing"} onClick={() => retrySkipped()}>
                {t("retrySkipped")}
              </button>
            )}
            <McpTokens />
            <AccountSecurity />
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
