import {
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type ScoreBreakdown as ScoreBreakdownType,
  type ScoreCategory,
} from "@/types";
import { cn } from "@/lib/utils/cn";

const ORDER: ScoreCategory[] = [
  "recentForm",
  "seasonBaseline",
  "matchup",
  "roleUsage",
  "injuryNews",
  "marketEdge",
  "sentiment",
  "historicalSplits",
  "parlaySuitability",
];

function barColor(score: number): string {
  if (score >= 62) return "bg-success";
  if (score >= 45) return "bg-primary";
  if (score >= 35) return "bg-warning";
  return "bg-danger";
}

export function ScoreBreakdown({ breakdown }: { breakdown: ScoreBreakdownType }) {
  return (
    <div className="space-y-2.5">
      {ORDER.map((cat) => {
        const score = breakdown[cat] ?? 50;
        return (
          <div key={cat} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-foreground/90">{CATEGORY_LABELS[cat]}</span>
              <span className="text-muted-foreground">
                {Math.round(CATEGORY_WEIGHTS[cat] * 100)}% weight
              </span>
            </div>
            <span className="row-span-2 w-10 text-right font-mono text-sm tabular-nums">
              {Math.round(score)}
            </span>
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
