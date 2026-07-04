"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ConfidenceBadge,
  DemoDataBadge,
  LeagueBadge,
  RiskBadge,
  TagChip,
  TeamStatusBadge,
  ValueBadge,
} from "@/components/badges";
import { TeamScoreBreakdown } from "@/components/TeamScoreBreakdown";
import { EvidenceList } from "@/components/EvidenceList";
import { formatGameDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { SerializedTeamPick } from "@/lib/dto";

function fmtPrice(p: number | null): string {
  if (p == null) return "—";
  return p > 0 ? `+${p}` : String(p);
}

export function TeamPickCard({ pick, defaultOpen = false }: { pick: SerializedTeamPick; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const homePicked = pick.recommendedSide === "HOME";

  return (
    <Card className="glass-hover overflow-hidden animate-in">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 font-mono text-sm font-bold text-primary">
            #{pick.rank}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LeagueBadge league={pick.league} />
              <span className="text-sm text-muted-foreground">
                {pick.awayTeam} <span className="text-foreground/50">@</span> {pick.homeTeam}
              </span>
              {pick.isDemo && <DemoDataBadge />}
            </div>
            <p className="mt-1 text-sm">
              Pick: <span className="font-semibold text-foreground">{pick.recommendedTeam}</span>{" "}
              <span className="text-muted-foreground">to win</span>{" "}
              <span className="font-mono text-primary">{Math.round(pick.winProbability * 100)}%</span>
              <span className="text-xs text-muted-foreground">
                {" "}
                (mkt {Math.round(pick.marketWinProb * 100)}% · {fmtPrice(pick.priceAmerican)})
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatGameDateTime(pick.gameStartTime, pick.date)}
              {pick.tags.slice(0, 3).map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <div className="flex items-center gap-2">
            <ConfidenceBadge score={pick.confidenceScore} />
            <RiskBadge risk={pick.riskLevel} />
          </div>
          <div className="flex items-center gap-2">
            <ValueBadge edge={pick.valueEdge} />
            <TeamStatusBadge status={pick.status} />
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-sm text-foreground/90">{pick.reasoningSummary}</p>
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {open ? "Hide" : "Show"} analysis
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/teams/${pick.id}`}>Full detail →</Link>
          </Button>
        </div>

        {open && (
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Score breakdown
              </h4>
              <TeamScoreBreakdown breakdown={pick.scoreBreakdown} />
              <p className="mt-2 text-xs text-muted-foreground">
                {homePicked ? "Home" : "Road"} side · model {Math.round(pick.winProbability * 100)}% vs market{" "}
                {Math.round(pick.marketWinProb * 100)}%.
              </p>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4>
              <EvidenceList evidence={pick.evidence} />
              {pick.warnings.length > 0 && (
                <div className="mt-3 space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[11px] text-warning">
                  {pick.warnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
