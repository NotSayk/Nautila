import { useEffect, useState } from "react";
import type { PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";
import {
  createShare,
  joinShare,
  leaveShare,
  parseShareId,
  publicLink,
  setMemberRole,
  setShareAccess,
  setSharePublic,
  shareInfo,
  shareLink,
  type ShareInfo,
  type ShareRole,
} from "../sync/share";
import { PageEditor } from "../editor/PageEditor";

const BUTTON = "h-8 rounded-md px-3 font-medium disabled:opacity-40";
const SELECT = "h-8 shrink-0 rounded-md bg-hover px-2 text-sm";
const FIELD = "h-8 w-full rounded-md bg-hover px-2 text-sm placeholder:text-faint";

function Shell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useOverlay(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-md rounded-xl bg-pop p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <p className="text-base font-semibold">{label}</p>
        {children}
      </div>
    </div>
  );
}

export function ShareDialog({
  page,
  peers,
  online,
  role,
  getDoc,
  onClose,
}: {
  role: ShareRole;
  page: PageMeta;
  peers: number;
  online: boolean;
  getDoc: () => string | null;
  onClose: () => void;
}) {
  const t = useT();
  const connected = useStore((s) => s.sync.status !== "off");
  const refreshPages = useStore((s) => s.refreshPages);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const [info, setInfo] = useState<ShareInfo>();
  const [viewLink, setViewLink] = useState("");

  useEffect(() => {
    if (!page.share_id || !connected) return;
    void shareLink(page.share_id).then(setLink);
    void publicLink(page.share_id).then(setViewLink);
    void shareInfo(page.share_id).then(setInfo, () => undefined);
    // Rechargé quand quelqu'un rejoint ou part, pour que la liste des participants reste à jour.
  }, [page.share_id, connected, peers]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      await refreshPages();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <Shell label={t("shareTitle")} onClose={onClose}>
      <p className="mt-2 text-[13px] leading-5 text-muted">{t("shareIntro")}</p>
      {!connected ? (
        <>
          <p className="mt-3">{t("shareNeedsAccount")}</p>
          <div className="mt-4 flex justify-end">
            <button
              className={`${BUTTON} bg-accent text-white`}
              onClick={() => {
                onClose();
                useStore.setState({ syncOpen: true });
              }}
            >
              {t("openSync")}
            </button>
          </div>
        </>
      ) : page.share_id ? (
        <>
          <input
            readOnly
            aria-label={t("shareCopy")}
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className={`${FIELD} mt-3`}
          />
          <p className={`mt-2 text-[13px] ${online ? "text-muted" : "text-danger"}`}>
            {online ? `${t("shareOnline")} · ${peers} ${t("sharePeers")}` : t("shareOffline")}
          </p>
          {!info?.owner && (role === "view" || role === "none") && (
            <p className="mt-2 text-[13px] text-muted">{t(role === "none" ? "shareRemovedHint" : "readOnlyHint")}</p>
          )}
          {info?.owner && (
            <div className="mt-4 pt-3 shadow-[inset_0_1px_0_var(--color-line)]">
              <label className="flex items-center justify-between gap-3">
                <span className="font-medium">{t("shareAccess")}</span>
                <select
                  className={SELECT}
                  value={info.access}
                  disabled={busy}
                  onChange={(e) =>
                    run(async () =>
                      setInfo({
                        ...info,
                        ...(await setShareAccess(page.share_id!, e.target.value as "edit" | "view")),
                      }),
                    )
                  }
                >
                  <option value="edit">{t("roleEdit")}</option>
                  <option value="view">{t("roleView")}</option>
                </select>
              </label>
              {(info.members ?? []).length > 0 && (
                <ul className="mt-2 max-h-40 overflow-y-auto" aria-label={t("shareMembers")}>
                  {info.members!.map((m) => (
                    <li key={m.id} className="flex min-h-9 items-center justify-between gap-3">
                      <span className={`truncate ${m.role === "none" ? "text-muted line-through" : ""}`}>
                        {m.username}
                      </span>
                      <select
                        aria-label={`${t("shareRoleOf")} ${m.username}`}
                        className={SELECT}
                        value={m.role ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          run(async () =>
                            setInfo({
                              ...info,
                              ...(await setMemberRole(
                                page.share_id!,
                                m.id,
                                (e.target.value || null) as "edit" | "view" | "none" | null,
                              )),
                            }),
                          )
                        }
                      >
                        <option value="">{t("roleDefault")}</option>
                        <option value="edit">{t("roleEdit")}</option>
                        <option value="view">{t("roleView")}</option>
                        <option value="none">{t("roleNone")}</option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              {(info.members ?? []).length === 0 && (
                <p className="mt-1 text-[13px] text-muted">{t("shareNoMembers")}</p>
              )}
            </div>
          )}
          {info?.owner && (
            <div className="mt-4 pt-3 shadow-[inset_0_1px_0_var(--color-line)]">
              <p className="font-medium">{t("publicLink")}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{t("publicIntro")}</p>
              {info.public && (
                <input
                  readOnly
                  aria-label={t("publicLink")}
                  value={viewLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${FIELD} mt-2`}
                />
              )}
              <button
                className={`${BUTTON} mt-2 shadow-[0_0_0_1px_var(--color-line)] hover:bg-hover`}
                disabled={busy}
                onClick={() =>
                  run(async () => setInfo({ ...info, ...(await setSharePublic(page.share_id!, !info.public)) }))
                }
              >
                {t(info.public ? "publicDisable" : "publicEnable")}
              </button>
            </div>
          )}
          <div className="mt-4 flex justify-between gap-2">
            <button
              className={`${BUTTON} text-danger hover:bg-hover`}
              disabled={busy}
              onClick={() => run(() => leaveShare(page.id, page.share_id!))}
            >
              {t("shareStop")}
            </button>
            <button
              className={`${BUTTON} bg-accent text-white`}
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => undefined);
                setCopied(true);
              }}
            >
              {t(copied ? "shareCopied" : "shareCopy")}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4 flex justify-end">
          <button
            className={`${BUTTON} bg-accent text-white`}
            disabled={busy}
            onClick={() => run(() => createShare(page.id, page.title, getDoc()))}
          >
            {t("shareCreate")}
          </button>
        </div>
      )}
      {failed && <p className="mt-3 text-danger">{t("errOffline")}</p>}
    </Shell>
  );
}

/** Boîte « Rejoindre une page partagée » : accepte le lien complet ou le code seul. */
export function JoinDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useStore((s) => s.navigate);
  const [value, setValue] = useState("");
  const id = parseShareId(value);
  return (
    <Shell label={t("joinShared")} onClose={onClose}>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!id) return;
          onClose();
          navigate({ view: "join", id });
        }}
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("joinPlaceholder")}
          className={FIELD}
        />
        <button disabled={!id} className={`${BUTTON} shrink-0 bg-accent text-white`}>
          {t("join")}
        </button>
      </form>
    </Shell>
  );
}

/** Écran d'arrivée d'un lien d'invitation : ajoute la page à cet appareil puis l'ouvre. */
export function JoinView({ id }: { id: string }) {
  const t = useT();
  const connected = useStore((s) => s.sync.status !== "off");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    joinShare(id).then(
      async (pageId) => {
        await useStore.getState().refreshPages();
        if (live) useStore.getState().navigate({ view: "page", id: pageId });
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [id, connected]);

  return (
    <div className="mx-auto max-w-md px-6 pt-[18vh] text-center">
      {!connected ? (
        <>
          <p>{t("shareNeedsAccount")}</p>
          <button
            className={`${BUTTON} mt-4 bg-accent text-white`}
            onClick={() => useStore.setState({ syncOpen: true })}
          >
            {t("openSync")}
          </button>
        </>
      ) : (
        <p className={failed ? "text-danger" : "text-muted"}>{t(failed ? "joinFailed" : "joining")}</p>
      )}
    </div>
  );
}

/** Page publique en lecture seule : affichée sans compte, rien n'est enregistré sur l'appareil. */
export function PublicView({ id }: { id: string }) {
  const t = useT();
  const [page, setPage] = useState<{ title: string; ydoc: string | null } | null>();

  useEffect(() => {
    fetch(`${location.origin}/api/public/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setPage, () => setPage(null));
  }, [id]);

  if (page === undefined) return null;
  if (page === null) return <p className="px-6 pt-[18vh] text-center text-muted">{t("publicMissing")}</p>;
  return (
    <div className="mx-auto max-w-[900px] pb-32 pt-12">
      <div className="px-(--page-pad)">
        <p className="mb-2 text-xs font-medium text-muted">Nautila · {t("publicView")}</p>
        <h1 className="mb-2 text-[40px] font-bold leading-[1.2]">{page.title || t("untitled")}</h1>
      </div>
      <PageEditor
        pageId={`public:${id}`}
        initialDoc={page.ydoc}
        editable={false}
        ephemeral
        fileResolver={async (url) =>
          url.startsWith("nautila-file:")
            ? `${location.origin}/api/public/${id}/file/${url.slice("nautila-file:".length)}`
            : url
        }
      />
    </div>
  );
}
