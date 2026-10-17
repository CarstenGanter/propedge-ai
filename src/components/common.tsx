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

  // A ruled stat, as in a newspaper's stat line: the number leads, the label follows.
  return (
    <div className="border-t-2 border-border-strong pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className={cn("font-serif text-[34px] font-semibold leading-none tabular-nums", accentColor)}>{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        {icon && <div className="text-muted-foreground" aria-hidden="true">{icon}</div>}
      </div>
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
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-muted-foreground" aria-hidden="true">{icon}</div>}
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
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
        <h2 className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A page's headline block: navy kicker, serif headline, a one-paragraph deck,
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
      <div className="min-w-0 max-w-3xl flex-[999_1_480px]">
        {kicker && <p className="kicker">{kicker}</p>}
        <h1 className="mt-1.5 font-serif text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">{title}</h1>
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        {description && (
          <p className="mt-3 max-w-[62ch] font-serif text-lg leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-[1_1_auto] flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
