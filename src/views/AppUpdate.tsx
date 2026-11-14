import { Download, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { isTauri } from "../db";
import { useT, type Key } from "../i18n";
import { progressPercent, RELEASES_URL, shouldOffer } from "../update/logic";
import {
  checkForUpdates,
  dismissUpdate,
  installUpdate,
  openReleases,
  restartApp,
  startUpdateChecks,
  useUpdate,
} from "../update/updater";
import type { MenuItem } from "./common";

const BUTTON = "h-7 rounded-md px-2.5 font-medium";
const PRIMARY = `${BUTTON} bg-accent text-white hover:opacity-90`;

/** Entrées du menu Paramètres : version installée et recherche manuelle (app de bureau seulement). */
export function useUpdateMenuItems(t: (key: Key) => string): MenuItem[] {
  const current = useUpdate((s) => s.current);
  if (!isTauri()) return [];
  return [
    "separator",
    ...(current ? [{ note: t("updateCurrent").replace("{version}", current) }] : []),
    { icon: <RefreshCw size={16} />, label: t("updateCheck"), onClick: () => void checkForUpdates(true) },
  ];
}

/** Bas de la barre latérale : lien de téléchargement dans le navigateur, carte de mise à jour dans l'app. */
export function AppUpdate() {
  return isTauri() ? <UpdateCard /> : <DownloadLink />;
}

function DownloadLink() {
  const t = useT();
  return (
    <a
      href={RELEASES_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-faint hover:bg-hover hover:text-muted"
    >
      <Download size={16} strokeWidth={1.75} />
      <span className="flex-1 truncate">{t("downloadApp")}</span>
    </a>
  );
}

function UpdateCard() {
  const t = useT();
  const { phase, found, dismissed, downloaded, total, installFailed, selfUpdate } = useUpdate();
  useEffect(startUpdateChecks, []);
  if (!found || (phase === "available" && !shouldOffer(found.version, dismissed))) return null;
  const percent = progressPercent(downloaded, total);
  return (
    <div className="mb-1 rounded-md bg-pop p-2.5 text-[13px] shadow-pop" role="status">
      <p className="font-medium text-ink">{t("updateAvailable").replace("{version}", found.version)}</p>
      {found.notes && phase === "available" && (
        <details className="mt-1 text-muted">
          <summary className="cursor-pointer select-none">{t("updateNotes")}</summary>
          <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">
            {found.notes}
          </p>
        </details>
      )}
      {installFailed && (
        <p className="mt-1.5 text-xs leading-5 text-danger">
          {t("updateInstallFailed")}{" "}
          <button className="underline" onClick={() => void openReleases()}>
            {t("updateReleasesPage")}
          </button>
        </p>
      )}
      {phase === "downloading" && (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-label={t("updateDownloading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            className="h-1.5 overflow-hidden rounded-full bg-hover"
          >
            <div
              className={`h-full rounded-full bg-accent ${percent === null ? "w-1/3 animate-pulse" : ""}`}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-faint">
            {t("updateDownloading")} {percent !== null && `${percent} %`}
          </p>
        </div>
      )}
      {phase === "ready" && <p className="mt-1.5 text-xs text-muted">{t("updateInstalled")}</p>}
      <div className="mt-2 flex gap-1.5">
        {phase === "available" && (
          <>
            <button className={PRIMARY} onClick={() => void (selfUpdate ? installUpdate() : openReleases())}>
              {t(selfUpdate ? "updateNow" : "updateViewRelease")}
            </button>
            <button className={`${BUTTON} text-muted hover:bg-hover`} onClick={dismissUpdate}>
              {t("updateLater")}
            </button>
          </>
        )}
        {phase === "ready" && (
          <button className={PRIMARY} onClick={() => void restartApp()}>
            {t("updateRestart")}
          </button>
        )}
      </div>
    </div>
  );
}
