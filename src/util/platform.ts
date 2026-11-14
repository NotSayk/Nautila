import { translate, type Lang } from "../i18n";

/** Vrai sur macOS et iOS, où le modificateur principal est ⌘ et non Ctrl. */
export const isMac = /Mac|iPhone|iPad/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
);

/**
 * Met en forme un raccourci pour l'affichage : `{mod}` devient ⌘ ou Ctrl, `{shift}` ⇧ ou Maj/Shift,
 * `{alt}` ⌥ ou Alt, `{space}` Espace/Space. Le reste du texte est conservé tel quel.
 */
export function fmtKeys(spec: string, lang: Lang): string {
  const words: Record<string, string> = {
    mod: isMac ? "⌘" : "Ctrl",
    shift: isMac ? "⇧" : translate(lang, "keyShift"),
    alt: isMac ? "⌥" : "Alt",
    space: translate(lang, "keySpace"),
  };
  return spec.replace(/\{(\w+)\}/g, (all, k: string) => words[k] ?? all);
}
