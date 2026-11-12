import { BookOpen, Check, FileText, GraduationCap, PanelLeft } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PageMeta } from "../data/pages";
import { translate, useT, type Lang } from "../i18n";
import { useStore } from "../store";

export function PageIcon({ page, size = 18 }: { page: Pick<PageMeta, "icon" | "kind">; size?: number }) {
  if (page.icon)
    return (
      <span className="grid shrink-0 place-items-center" style={{ fontSize: size * 0.9, width: size, height: size, lineHeight: 1 }}>
        {page.icon}
      </span>
    );
  const Icon = page.kind === "semester" ? GraduationCap : page.kind === "course" ? BookOpen : FileText;
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

/** Panneau flottant ancré sous un élément, fermé par un clic à l'extérieur. */
export function Popover({
  anchor,
  onClose,
  width,
  align = "left",
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width: number;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const left = align === "right" ? anchor.right - width : anchor.left;
    const below = anchor.bottom + 4;
    setPos({
      left: Math.max(8, Math.min(left, innerWidth - width - 8)),
      // Bascule au-dessus de l'ancre s'il n'y a pas la place en dessous.
      top: below + height > innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below,
    });
  }, [anchor, width, align]);

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div
        ref={ref}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{ width, ...(pos ?? { visibility: "hidden" }) }}
        className="fixed rounded-lg bg-pop p-1 text-sm shadow-pop"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type MenuItem =
  | { icon?: React.ReactNode; label: string; onClick: () => void; danger?: boolean; checked?: boolean }
  | "separator";

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
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={230} align={align}>
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} className="my-1 h-px bg-line" />
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
      <div className="flex min-w-0 flex-1 items-center gap-0.5">{children}</div>
      {right && <div className="flex shrink-0 items-center gap-0.5">{right}</div>}
    </header>
  );
}

export function View({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
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
