import { AlertTriangle, FlaskConical, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { RiskLevel, SettlementStatus, TeamStatus } from "@/types";
import { LEAGUE_LABELS, type League } from "@/lib/teamLeagues";

export function ConfidenceBadge({ score, className }: { score: number; className?: string }) {
  const variant =
    score >= 80 ? "success" : score >= 70 ? "default" : score >= 60 ? "warning" : "muted";
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

const SPORT_COLORS: Record<string, string> = {
  NFL: "bg-amber-500/15 text-amber-300",
  NBA: "bg-orange-500/15 text-orange-300",
  NCAAB: "bg-blue-500/15 text-blue-300",
  MLB: "bg-red-500/15 text-red-300",
  WNBA: "bg-fuchsia-500/15 text-fuchsia-300",
  NHL: "bg-cyan-500/15 text-cyan-300",
  Soccer: "bg-emerald-500/15 text-emerald-300",
};

export function SportBadge({ sport }: { sport: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
        SPORT_COLORS[sport] ?? "bg-muted text-muted-foreground",
      )}
    >
      {sport}
    </span>
  );
}

const LEAGUE_COLORS: Record<string, string> = {
  NFL: "bg-amber-500/15 text-amber-300",
  MLB: "bg-red-500/15 text-red-300",
  CBB: "bg-blue-500/15 text-blue-300",
  WNBA: "bg-fuchsia-500/15 text-fuchsia-300",
  EPL: "bg-violet-500/15 text-violet-300",
  Bundesliga: "bg-rose-500/15 text-rose-300",
  UCL: "bg-indigo-500/15 text-indigo-300",
  WorldCup: "bg-emerald-500/15 text-emerald-300",
};

export function LeagueBadge({ league }: { league: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
        LEAGUE_COLORS[league] ?? "bg-muted text-muted-foreground",
      )}
    >
      {LEAGUE_LABELS[league as League] ?? league}
    </span>
  );
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
