import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, GraduationCap, PanelLeft, Table2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveFileUrl } from "../data/files";
import type { PageMeta } from "../data/pages";
import { translate, useT, type Lang } from "../i18n";
import { useStore } from "../store";

export function PageIcon({ page, size = 18 }: { page: Pick<PageMeta, "icon" | "kind">; size?: number }) {
  if (page.icon)
    return (
      <span
        className="grid shrink-0 place-items-center"
        style={{ fontSize: size * 0.9, width: size, height: size, lineHeight: 1 }}
      >
        {page.icon}
      </span>
    );
  const Icon =
    page.kind === "semester"
      ? GraduationCap
      : page.kind === "course"
        ? BookOpen
        : page.kind === "database"
          ? Table2
          : FileText;
  return <Icon size={size} strokeWidth={1.75} className="shrink-0 text-muted" />;
}

const DAY = 86_400_000;
const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);

/** Nombre de jours entiers entre aujourd'hui et la date (négatif si passée). */
export const daysUntil = (ts: number, now = Date.now()) => Math.round((startOfDay(ts) - startOfDay(now)) / DAY);

export function formatDue(ts: number, lang: Lang): string {
  const days = daysUntil(ts);
  if (days === 0) return translate(lang, "today");
  if (days === 1) return translate(lang, "tomorrow");
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(ts);
}

export function relativeTime(ts: number, lang: Lang, now = Date.now()): string {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return translate(lang, "now");
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (min < 60) return rtf.format(-min, "minute");
  if (min < 1440) return rtf.format(-Math.round(min / 60), "hour");
  if (min < 43_200) return rtf.format(-Math.round(min / 1440), "day");
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(ts);
}

export function IconButton({
  label,
  className = "",
  ...rest
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover ${className}`}
      {...rest}
    />
  );
}

/**
 * Pour une fenêtre ou un menu : Échap le ferme, et le focus revient à l'élément
 * qui l'avait ouvert, pour ne pas perdre sa place en naviguant au clavier.
 */
const overlays: object[] = [];
export function useOverlay(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const self = useRef({}).current;
  // Relevé dès le premier rendu, avant que le contenu de la fenêtre ne prenne le focus.
  const opener = useRef(document.activeElement as HTMLElement | null).current;
  useEffect(() => {
    overlays.push(self);
    const onKey = (e: KeyboardEvent) => {
      // Seule la fenêtre du dessus réagit à Échap.
      if (e.key !== "Escape" || overlays[overlays.length - 1] !== self) return;
      e.stopPropagation();
      close.current();
    };
    // En capture : Échap ferme la fenêtre du dessus avant que l'éditeur ne le reçoive.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      overlays.splice(overlays.indexOf(self), 1);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
}

/** Panneau flottant ancré sous un élément, fermé par un clic à l'extérieur. */
export function Popover({
  anchor,
  onClose,
  width,
  align = "left",
  role,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width: number;
  align?: "left" | "right";
  /** "menu" seulement pour une liste d'entrées ; un panneau avec des champs n'a pas de rôle. */
  role?: "menu";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(onClose);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport(innerWidth * 10_000 + innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Jamais plus large que la fenêtre (marge de 8 px de chaque côté).
  const fit = Math.min(width, innerWidth - 16);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const left = align === "right" ? anchor.right - fit : anchor.left;
    const below = anchor.bottom + 4;
    setPos({
      left: Math.max(8, Math.min(left, innerWidth - fit - 8)),
      // (Invisible mais focalisable tant que la position est inconnue.)
      // Bascule au-dessus de l'ancre s'il n'y a pas la place en dessous.
      top: below + height > innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below,
    });
  }, [anchor, fit, align, viewport]);

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={ref}
        role={role}
        onClick={(e) => e.stopPropagation()}
        style={{ width: fit, maxHeight: "calc(100dvh - 16px)", ...(pos ?? { top: 0, left: 0, opacity: 0 }) }}
        className="fixed overflow-y-auto rounded-lg bg-pop p-1 text-sm shadow-pop"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type MenuItem =
  | { icon?: React.ReactNode; label: string; onClick: () => void; danger?: boolean; checked?: boolean }
  | { note: string }
  | "separator";

/** Liste d'entrées de menu : le focus arrive sur la première, les flèches le déplacent. */
function MenuList({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(), []);
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "ArrowDown"
            ? (at + 1) % items.length
            : e.key === "ArrowUp"
              ? (at - 1 + items.length) % items.length
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : -1;
        if (next < 0) return;
        e.preventDefault();
        items[next]?.focus();
      }}
    >
      {children}
    </div>
  );
}

export function Menu({
  label,
  trigger,
  items,
  align,
  className = "",
}: {
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  className?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        className={className}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        {trigger}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={230} align={align} role="menu">
          <MenuList>
            {items.map((item, i) =>
              item === "separator" ? (
                <div key={i} className="my-1 h-px bg-line" />
              ) : "note" in item ? (
                <p key={i} className="px-2 py-1 text-xs text-faint">
                  {item.note}
                </p>
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  onClick={() => {
                    setAnchor(null);
                    item.onClick();
                  }}
                  className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover ${
                    item.danger ? "text-danger" : ""
                  }`}
                >
                  {item.icon && <span className={item.danger ? "" : "text-muted"}>{item.icon}</span>}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.checked && <Check size={14} />}
                </button>
              ),
            )}
          </MenuList>
        </Popover>
      )}
    </>
  );
}

/** Barre supérieure commune ; porte le bouton qui rouvre la barre latérale. */
export function TopBar({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  const t = useT();
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  return (
    <header className="sticky top-0 z-10 flex h-11 items-center gap-1 bg-bg px-3">
      {!sidebarOpen && (
        <IconButton label={t("openSidebar")} onClick={() => setSidebarOpen(true)}>
          <PanelLeft size={18} strokeWidth={1.75} />
        </IconButton>
      )}
      <IconButton label={t("back")} onClick={() => history.back()} className="max-sm:hidden">
        <ArrowLeft size={18} strokeWidth={1.75} />
      </IconButton>
      <IconButton label={t("forward")} onClick={() => history.forward()} className="max-sm:hidden">
        <ArrowRight size={18} strokeWidth={1.75} />
      </IconButton>
      <div className="flex min-w-0 flex-1 items-center gap-0.5">{children}</div>
      {right && <div className="flex shrink-0 items-center gap-0.5">{right}</div>}
    </header>
  );
}

export function View({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar right={right}>
        <span className="truncate px-1.5">{title}</span>
      </TopBar>
      <div className="mx-auto max-w-[900px] px-(--page-pad) pb-24 pt-10">
        <h1 className="mb-8 text-[30px] font-bold leading-tight">{title}</h1>
        {children}
      </div>
    </>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">{children}</h2>;
}

/** Bandeau de couverture : une couleur (`color:#hex`) ou une image stockée. */
export function Cover({ value }: { value: string }) {
  const [url, setUrl] = useState("");
  const color = value.startsWith("color:") ? value.slice(6) : null;
  useEffect(() => {
    let live = true;
    if (!color) resolveFileUrl(value).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [value, color]);
  return color ? (
    <div className="h-full w-full" style={{ background: color }} />
  ) : (
    url && <img src={url} alt="" className="h-full w-full object-cover" />
  );
}
