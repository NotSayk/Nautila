import { BookOpen, FileText, GraduationCap } from "lucide-react";
import type { PageMeta } from "../data/pages";
import { translate, type Lang } from "../i18n";

export function PageIcon({ page, size = 16 }: { page: Pick<PageMeta, "icon" | "kind">; size?: number }) {
  if (page.icon) return <span style={{ fontSize: size, lineHeight: 1 }}>{page.icon}</span>;
  const Icon = page.kind === "semester" ? GraduationCap : page.kind === "course" ? BookOpen : FileText;
  return <Icon size={size} className="shrink-0 text-muted" />;
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

export function View({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
      <h1 className="mb-6 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
