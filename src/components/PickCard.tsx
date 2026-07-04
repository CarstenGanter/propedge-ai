"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Clock, ThumbsDown, ThumbsUp, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ConfidenceBadge,
  DemoDataBadge,
  RiskBadge,
  SportBadge,
  StatusBadge,
  TagChip,
} from "@/components/badges";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { EvidenceList } from "@/components/EvidenceList";
import { UnderdogEdgeBadge, UnderdogLineInput } from "@/components/UnderdogLine";
import { formatSignedNumber } from "@/lib/utils/format";
import { formatGameDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { SerializedPick } from "@/lib/dto";

export function PickCard({ pick, defaultOpen = false }: { pick: SerializedPick; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const p = pick.prop;

  return (
    <Card className="glass-hover overflow-hidden animate-in">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 font-mono text-sm font-bold text-primary">
            #{pick.rank}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SportBadge sport={p.sport} />
              <span className="truncate text-sm font-semibold">{p.playerName}</span>
              {pick.isDemo && <DemoDataBadge />}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {p.team} vs {p.opponent} · <span className="font-medium text-foreground/80">{p.direction} {p.line} {p.propType}</span>
            </p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatGameDateTime(p.gameStartTime, p.date)}
              {pick.tags.slice(0, 2).map((t) => (
                <TagChip key={t} tag={t} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <div className="flex items-center gap-2">
            <ConfidenceBadge score={pick.confidenceScore} />
            <RiskBadge risk={pick.riskLevel} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> edge {formatSignedNumber(pick.edgeScore)}
            </span>
            {pick.underdogEdge != null && <UnderdogEdgeBadge edge={pick.underdogEdge} />}
            <StatusBadge status={pick.status} />
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <p className="text-sm text-foreground/90">{pick.reasoningSummary}</p>
        <div className="mt-3">
          <UnderdogLineInput
            pickId={pick.id}
            underdogLine={p.underdogLine}
            marketLine={p.marketLine ?? p.line}
            edge={pick.underdogEdge}
            compact
          />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {open ? "Hide" : "Show"} analysis
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/picks/${pick.id}`}>Full detail →</Link>
          </Button>
        </div>

        {open && (
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Score breakdown
                </h4>
                <ScoreBreakdown breakdown={pick.scoreBreakdown} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="mb-1 flex items-center gap-1 font-semibold text-success">
                    <ThumbsUp className="h-3 w-3" /> Reasons to take
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    {pick.reasonsFor.length ? (
                      pick.reasonsFor.map((r, i) => <li key={i}>• {r}</li>)
                    ) : (
                      <li>• Limited positive signal</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 font-semibold text-danger">
                    <ThumbsDown className="h-3 w-3" /> Reasons to avoid
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    {pick.reasonsAgainst.length ? (
                      pick.reasonsAgainst.map((r, i) => <li key={i}>• {r}</li>)
                    ) : (
                      <li>• Standard game variance</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence
              </h4>
              <EvidenceList evidence={pick.evidence.slice(0, 5)} />
              {pick.warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[11px] text-warning">
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
