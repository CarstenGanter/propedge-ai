import { AlertTriangle, FlaskConical, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { RiskLevel, SettlementStatus, TeamStatus } from "@/types";
import { LEAGUE_LABELS, type League } from "@/lib/teamLeagues";

export function ConfidenceBadge({ score, className }: { score: number; className?: string }) {
  // Model confidence is not an edge (the books decide that), so it never borrows the verdict greens.
  const variant = score >= 70 ? "default" : "muted";
  return (
    <Badge variant={variant} className={cn("font-mono tabular-nums", className)}>
      {Math.round(score)}<span className="opacity-60">/100</span>
    </Badge>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const variant = risk === "Low" ? "success" : risk === "Medium" ? "warning" : "danger";
  return (
    <Badge variant={variant}>
      {risk === "High" && <AlertTriangle className="h-3 w-3" />}
      {risk} risk
    </Badge>
  );
}

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: "Pending",
  hit: "Hit",
  miss: "Miss",
  push: "Push",
  void: "Void",
};

export function StatusBadge({ status }: { status: SettlementStatus }) {
  const variant =
    status === "hit"
      ? "success"
      : status === "miss"
        ? "danger"
        : status === "pending"
          ? "muted"
          : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export function DemoDataBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={cn("border border-warning/30", className)}>
      <FlaskConical className="h-3 w-3" />
      Demo Data
    </Badge>
  );
}

// Sports and leagues are labels, set like a printed tag. Colour is kept for
// verdicts, so no sport gets a hue of its own.
const TAG_CLASS =
  "inline-flex items-center rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-foreground";

export function SportBadge({ sport }: { sport: string }) {
  return <span className={TAG_CLASS}>{sport}</span>;
}

export function LeagueBadge({ league }: { league: string }) {
  return <span className={TAG_CLASS}>{LEAGUE_LABELS[league as League] ?? league}</span>;
}

/** Value edge (percentage points): green when the model beats the price. */
export function ValueBadge({ edge, className }: { edge: number; className?: string }) {
  // edge is fractional (0.034 = 3.4%)
  const pts = edge * 100;
  if (pts >= 3)
    return (
      <Badge variant="success" className={cn("font-mono", className)}>
        <Sparkles className="h-3 w-3" /> +{pts.toFixed(1)}% value
      </Badge>
    );
  if (pts <= -3)
    return (
      <Badge variant="danger" className={cn("font-mono", className)}>
        {pts.toFixed(1)}% no value
      </Badge>
    );
  return (
    <Badge variant="muted" className={cn("font-mono", className)}>
      {pts >= 0 ? "+" : ""}
      {pts.toFixed(1)}% edge
    </Badge>
  );
}

const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  pending: "Pending",
  win: "Win",
  loss: "Loss",
  push: "Push",
  void: "Void",
};

export function TeamStatusBadge({ status }: { status: TeamStatus }) {
  const variant =
    status === "win"
      ? "success"
      : status === "loss"
        ? "danger"
        : status === "pending"
          ? "muted"
          : "outline";
  return <Badge variant={variant}>{TEAM_STATUS_LABEL[status]}</Badge>;
}

export function TagChip({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      {tag}
    </span>
  );
}
