"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Layers, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfidenceBadge, RiskBadge, SportBadge } from "@/components/badges";
import { EmptyState } from "@/components/common";
import {
  analyzeParlay,
  makeGameKey,
  parlayPayout,
  type ParlayLegInput,
} from "@/lib/analysis/parlayCorrelation";
import { createParlay } from "@/server/actions/parlays";
import { formatCurrency, formatSignedCurrency } from "@/lib/utils/format";
import type { SerializedPick } from "@/lib/dto";
import { cn } from "@/lib/utils/cn";

export function ParlayBuilder({
  picks,
  defaultStake,
}: {
  picks: SerializedPick[];
  defaultStake: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [name, setName] = React.useState("");
  const [stake, setStake] = React.useState(String(defaultStake));
  const [multiplier, setMultiplier] = React.useState("3");
  const [placedReal, setPlacedReal] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const legs: ParlayLegInput[] = picks
    .filter((p) => selected.has(p.id))
    .map((p) => ({
      pickId: p.id,
      playerName: p.prop.playerName,
      team: p.prop.team,
      opponent: p.prop.opponent,
      gameKey: makeGameKey(p.prop.team, p.prop.opponent, p.prop.date),
      propType: p.prop.propType,
      direction: p.prop.direction,
      confidenceScore: p.confidenceScore,
      riskLevel: p.riskLevel,
    }));

  const analysis = analyzeParlay(legs);
  const stakeNum = Number(stake) || 0;
  const multNum = Number(multiplier) || 0;
  const payout = parlayPayout(stakeNum, multNum);

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
      const res = await createParlay({
        name,
        stake: stakeNum,
        payoutMultiplier: multNum,
        pickIds: [...selected],
        placedReal,
      });
      if (res.ok) {
        setSelected(new Set());
        setName("");
        setMsg("Parlay saved.");
        router.refresh();
      } else {
        setMsg(res.error ?? "Could not save parlay.");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Select legs ({picks.length} pending picks)</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[560px] space-y-2 overflow-y-auto">
          {picks.length === 0 ? (
            <EmptyState title="No pending picks" description="Generate some picks first, then build a parlay." />
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
                      <SportBadge sport={p.prop.sport} />
                      <span className="truncate text-sm font-medium">{p.prop.playerName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {p.prop.direction} {p.prop.line} {p.prop.propType} · {p.prop.team} vs {p.prop.opponent}
                    </p>
                  </div>
                  <ConfidenceBadge score={p.confidenceScore} />
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Parlay ticket
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My 3-leg" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Stake ($)</Label>
              <Input type="number" step="0.5" value={stake} onChange={(e) => setStake(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Payout multiplier</Label>
              <Input type="number" step="0.1" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Legs</span><span>{analysis.legCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Avg confidence</span><span>{analysis.averageConfidence || "—"}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Combined risk</span>
              {analysis.legCount > 0 ? <RiskBadge risk={analysis.combinedRisk} /> : <span>—</span>}
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Model est. all hit</span><span>{analysis.legCount ? `${(analysis.combinedHitEstimate * 100).toFixed(0)}%` : "—"}</span></div>
            <div className="my-2 border-t border-border/60" />
            <div className="flex justify-between"><span className="text-muted-foreground">Projected payout</span><span className="font-medium">{formatCurrency(payout.projectedPayout)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Profit if won</span><span className="text-success">{formatSignedCurrency(payout.profitIfWon)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Loss if lost</span><span className="text-danger">{formatSignedCurrency(payout.lossIfLost)}</span></div>
          </div>

          {analysis.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </p>
          ))}
          {analysis.suggestions.map((s, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {s}
            </p>
          ))}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={placedReal} onChange={(e) => setPlacedReal(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            I actually placed this entry
          </label>

          <Button className="w-full" onClick={save} disabled={pending || selected.size < 2}>
            {pending ? "Saving…" : `Save parlay (${selected.size} legs)`}
          </Button>
          {msg && <p className="text-center text-xs text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
