import {
  TEAM_CATEGORY_LABELS,
  TEAM_CATEGORY_WEIGHTS,
  type TeamScoreBreakdown as TeamScoreBreakdownType,
  type TeamScoreCategory,
} from "@/types";
import { cn } from "@/lib/utils/cn";

const ORDER: TeamScoreCategory[] = ["marketProb", "form", "injuries", "homeAdvantage", "value"];

function barColor(score: number): string {
  if (score >= 62) return "bg-success";
  if (score >= 45) return "bg-primary";
  if (score >= 35) return "bg-warning";
  return "bg-danger";
}

export function TeamScoreBreakdown({ breakdown }: { breakdown: TeamScoreBreakdownType }) {
  return (
    <div className="space-y-2.5">
      {ORDER.map((cat) => {
        const score = breakdown[cat] ?? 50;
        return (
          <div key={cat} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/90">{TEAM_CATEGORY_LABELS[cat]}</span>
              <span className="text-muted-foreground">{Math.round(TEAM_CATEGORY_WEIGHTS[cat] * 100)}% weight</span>
            </div>
            <span className="row-span-2 w-10 text-right font-mono text-sm tabular-nums">{Math.round(score)}</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", barColor(score))}
                style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
