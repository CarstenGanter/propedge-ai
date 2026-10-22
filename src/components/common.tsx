import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: "primary" | "success" | "danger" | "warning" | "muted";
  icon?: React.ReactNode;
}) {
  const accentColor = {
    primary: "text-primary",
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
    muted: "text-foreground",
  }[accent ?? "muted"];

  // A KPI card: what it is, the figure in its verdict colour, then the context.
  return (
    <div className="glass flex flex-col gap-3 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="kicker">{label}</p>
        {icon && <div className="text-faint [&_svg]:size-4" aria-hidden="true">{icon}</div>}
      </div>
      <p className={cn("text-3xl font-semibold leading-none tracking-tight tabular-nums", accentColor)}>{value}</p>
      {sub && <p className="text-xs leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface/40 px-6 py-14 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-muted-foreground" aria-hidden="true">{icon}</div>}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A page's headline block: an overline, the title, a one-paragraph summary,
 * and the page's actions on the right (they wrap below on a phone).
 */
export function PageHeader({
  kicker,
  title,
  description,
  meta,
  actions,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl flex-1 basis-96">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        {description && <p className="mt-3 max-w-prose text-base leading-relaxed text-body">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
