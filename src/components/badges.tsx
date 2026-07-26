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
  NFL: "bg-amber-500/10 text-amber-400",
  NBA: "bg-orange-500/10 text-orange-400",
  NCAAB: "bg-blue-500/10 text-blue-400",
  MLB: "bg-red-500/10 text-red-400",
  WNBA: "bg-fuchsia-500/10 text-fuchsia-400",
  NHL: "bg-cyan-500/10 text-cyan-400",
  Soccer: "bg-emerald-500/10 text-emerald-400",
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
  NFL: "bg-amber-500/10 text-amber-400",
  MLB: "bg-red-500/10 text-red-400",
  CBB: "bg-blue-500/10 text-blue-400",
  WNBA: "bg-fuchsia-500/10 text-fuchsia-400",
  EPL: "bg-violet-500/10 text-violet-400",
  Bundesliga: "bg-rose-500/10 text-rose-400",
  UCL: "bg-indigo-500/10 text-indigo-400",
  WorldCup: "bg-emerald-500/10 text-emerald-400",
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
