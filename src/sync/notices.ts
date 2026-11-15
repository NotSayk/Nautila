import type { Key } from "../i18n";

/**
 * Bilan de « Déconnecter les autres appareils » : sessions fermées, et jetons du connecteur IA
 * révoqués (seulement si le serveur, à partir de cette version, les compte).
 */
export function logoutOthersNotice(result: { revoked: number; mcp?: number }, t: (key: Key) => string): string {
  const sessions = `${t("logoutOthersDone")} ${result.revoked}`;
  return typeof result.mcp === "number" ? `${sessions} · ${t("logoutOthersMcp")} ${result.mcp}` : sessions;
}
