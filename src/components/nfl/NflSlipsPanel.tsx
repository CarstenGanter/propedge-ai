"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, RiskBadge } from "@/components/badges";
import { buildSuggestedSlips, pickToSlipCandidate, type SuggestedSlip } from "@/lib/analysis/slipBuilder";
import { parlayPayout } from "@/lib/analysis/parlayCorrelation";
import { createParlay } from "@/server/actions/parlays";
import { formatCurrency } from "@/lib/utils/format";
import type { SerializedPick } from "@/lib/dto";

export function NflSlipsPanel({
  picks,
  date,
  defaultStake,
}: {
  picks: SerializedPick[];
  date: string;
  defaultStake: number;
}) {
  const pendingPicks = picks.filter((p) => p.status === "pending");
  const slips = React.useMemo(
    () => buildSuggestedSlips(pendingPicks.map(pickToSlipCandidate), [2, 3, 4]),
    [pendingPicks],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Suggested slips
        </CardTitle>
        <CardDescription>
          Built from the highest-confidence picks: never the same player twice, never opposite sides of one game,
          different games first. Enter your Underdog/PrizePicks lines on the picks before you trust the numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {slips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendingPicks.length < 2 ? "Need at least two pending picks to suggest a slip." : "Not enough independent picks to build a slip."}
          </p>
        ) : (
          slips.map((slip) => <SlipCard key={slip.size} slip={slip} date={date} defaultStake={defaultStake} />)
        )}
      </CardContent>
    </Card>
  );
}

function SlipCard({ slip, date, defaultStake }: { slip: SuggestedSlip; date: string; defaultStake: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [multiplier, setMultiplier] = React.useState(String(slip.multiplier));
  const [msg, setMsg] = React.useState<string | null>(null);
  const mult = Number(multiplier) || 0;
  const payout = parlayPayout(defaultStake, mult);
  const ids = slip.legs.map((l) => l.pickId);

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await createParlay({
        name: `NFL ${slip.size}-leg ${date}`,
        stake: defaultStake,
        payoutMultiplier: mult,
        pickIds: ids,
        date,
      });
      setMsg(r.ok ? "Saved to Parlay Builder." : r.error ?? "Could not save.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{slip.size}-leg slip</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Avg</span>
          <ConfidenceBadge score={slip.analysis.averageConfidence} />
          <RiskBadge risk={slip.analysis.combinedRisk} />
        </div>
      </div>

      <ol className="mt-2 space-y-2">
        {slip.legs.map((l, i) => (
          <li key={l.pickId} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {i + 1}. {l.playerName}{" "}
                <span className="text-foreground/80">
                  {l.direction === "OVER" ? "Higher" : "Lower"} {l.line} {l.propType}
                </span>
              </span>
              <span className="font-mono text-muted-foreground">{Math.round(l.confidenceScore)}</span>
            </div>
            <p className="text-muted-foreground">
              {l.team} vs {l.opponent} · {l.whyLine}
            </p>
          </li>
        ))}
      </ol>

      {slip.flags.map((f, i) => (
        <p key={i} className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f}
        </p>
      ))}

      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Model est. all hit</span>
        <span>{(slip.analysis.combinedHitEstimate * 100).toFixed(0)}% (independent estimate)</span>
        <span className="text-muted-foreground">Payout multiplier</span>
        <span className="flex items-center gap-2">
          <input
            type="number"
            step="0.5"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="h-7 w-16 rounded-md border border-border bg-input/60 px-2 text-xs"
          />
          <span className="text-muted-foreground">
            × {formatCurrency(defaultStake)} → {formatCurrency(payout.projectedPayout)}
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href={`/parlays?legs=${ids.join(",")}&mult=${mult}&date=${date}`}>Open in Parlay Builder</Link>
        </Button>
        <Button size="sm" onClick={save} disabled={pending || mult <= 0}>
          {pending ? "Saving…" : "Save slip"}
        </Button>
        {msg && <Badge variant="muted">{msg}</Badge>}
      </div>
    </div>
  );
}
