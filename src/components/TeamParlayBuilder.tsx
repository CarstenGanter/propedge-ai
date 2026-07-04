"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lightbulb, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfidenceBadge, RiskBadge, LeagueBadge, ValueBadge } from "@/components/badges";
import { EmptyState } from "@/components/common";
import { analyzeTeamParlay, teamParlayOdds, type TeamParlayLegInput } from "@/lib/analysis/teamParlay";
import { createTeamParlay } from "@/server/actions/teamParlays";
import { formatCurrency, formatSignedCurrency } from "@/lib/utils/format";
import type { SerializedTeamPick } from "@/lib/dto";
import { cn } from "@/lib/utils/cn";

function fmtPrice(p: number | null | undefined): string {
  if (p == null) return "even";
  return p > 0 ? `+${Math.round(p)}` : `${Math.round(p)}`;
}
function fmtAmerican(p: number): string {
  return p > 0 ? `+${p}` : `${p}`;
}

export function TeamParlayBuilder({
  picks,
  defaultStake,
}: {
  picks: SerializedTeamPick[];
  defaultStake: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [name, setName] = React.useState("");
  const [stake, setStake] = React.useState(String(defaultStake));
  const [placedReal, setPlacedReal] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const chosen = picks.filter((p) => selected.has(p.id));
  const legs: TeamParlayLegInput[] = chosen.map((p) => ({
    teamPickId: p.id,
    recommendedTeam: p.recommendedTeam,
    opponent: p.recommendedSide === "HOME" ? p.awayTeam : p.homeTeam,
    side: p.recommendedSide,
    league: p.league,
    priceAmerican: p.priceAmerican,
    winProbability: p.winProbability,
    confidenceScore: p.confidenceScore,
    riskLevel: p.riskLevel,
    drawProbability: p.tags.includes("draw risk") ? 0.3 : null,
  }));

  const analysis = analyzeTeamParlay(legs);
  const stakeNum = Number(stake) || 0;
  const odds = teamParlayOdds(chosen.map((p) => ({ priceAmerican: p.priceAmerican })), stakeNum);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await createTeamParlay({
        name,
        stake: stakeNum,
        teamPickIds: [...selected],
        placedReal,
      });
      if (res.ok) {
        setSelected(new Set());
        setName("");
        setMsg("Team parlay saved.");
        router.refresh();
      } else {
        setMsg(res.error ?? "Could not save team parlay.");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Pick teams to win ({picks.length} pending team picks)</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[560px] space-y-2 overflow-y-auto">
          {picks.length === 0 ? (
            <EmptyState
              title="No pending team picks"
              description="Generate team picks first (Team Picks → Fetch + generate), then combine winners here."
            />
          ) : (
            picks.map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    on ? "border-primary/50 bg-primary/10" : "border-border/60 bg-muted/20 hover:border-border",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <LeagueBadge league={p.league} />
                      <span className="truncate text-sm font-medium">{p.recommendedTeam}</span>
                      <span className="font-mono text-xs text-primary">{fmtPrice(p.priceAmerican)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      to beat {p.recommendedSide === "HOME" ? p.awayTeam : p.homeTeam} · model{" "}
                      {Math.round(p.winProbability * 100)}%
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.valueEdge >= 0.03 && <ValueBadge edge={p.valueEdge} />}
                    <ConfidenceBadge score={p.confidenceScore} />
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" /> Moneyline parlay ticket
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My 3-team ML" />
          </div>
          <div className="space-y-1">
            <Label>Stake ($)</Label>
            <Input type="number" step="0.5" value={stake} onChange={(e) => setStake(e.target.value)} />
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Legs</span>
              <span>{analysis.legCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Combined odds</span>
              <span className="font-mono">
                {analysis.legCount ? `${fmtAmerican(odds.combinedAmerican)} (${odds.combinedDecimal.toFixed(2)}x)` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg confidence</span>
              <span>{analysis.averageConfidence || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Combined risk</span>
              {analysis.legCount > 0 ? <RiskBadge risk={analysis.combinedRisk} /> : <span>—</span>}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Model est. all win</span>
              <span>{analysis.legCount ? `${(analysis.combinedHitEstimate * 100).toFixed(0)}%` : "—"}</span>
            </div>
            <div className="my-2 border-t border-border/60" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Projected payout</span>
              <span className="font-medium">{formatCurrency(odds.projectedPayout)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Profit if won</span>
              <span className="text-success">{formatSignedCurrency(odds.profitIfWon)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Loss if lost</span>
              <span className="text-danger">{formatSignedCurrency(-stakeNum)}</span>
            </div>
          </div>

          {analysis.warnings.map((w, i) => (
            <p
              key={i}
              className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-warning"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </p>
          ))}
          {analysis.suggestions.map((s, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {s}
            </p>
          ))}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={placedReal}
              onChange={(e) => setPlacedReal(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            I actually placed this entry
          </label>

          <Button className="w-full" onClick={save} disabled={pending || selected.size < 2}>
            {pending ? "Saving…" : `Save team parlay (${selected.size} legs)`}
          </Button>
          {msg && <p className="text-center text-xs text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
