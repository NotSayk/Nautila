import { useEffect, useState } from "react";
import type { PageMeta } from "../data/pages";
import { useT } from "../i18n";
import { useStore } from "../store";
import { useOverlay } from "./common";
import { createShare, joinShare, leaveShare, parseShareId, shareLink } from "../sync/share";

const BUTTON = "h-8 rounded-md px-3 font-medium disabled:opacity-40";
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
  getDoc,
  onClose,
}: {
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

  useEffect(() => {
    if (page.share_id && connected) void shareLink(page.share_id).then(setLink);
  }, [page.share_id, connected]);

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
