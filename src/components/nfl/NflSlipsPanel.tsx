"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Layers, Link2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge, RiskBadge } from "@/components/badges";
import {
  buildSuggestedSlips,
  correlatedPairsFor,
  pickToSlipCandidate,
  type SlipBasis,
  type SuggestedSlip,
} from "@/lib/analysis/slipBuilder";
import { parlayPayout } from "@/lib/analysis/parlayCorrelation";
import { quarterKelly, slipEconomics, STANDARD_PICK_PAYOUT } from "@/lib/analysis/pickemMath";
import { createParlay } from "@/server/actions/parlays";
import { setPicksTakenFlag } from "@/server/actions/bankroll";
import { formatCurrency } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { SerializedPick } from "@/lib/dto";

export function NflSlipsPanel({
  picks,
  date,
  defaultStake,
  calibrated = false,
}: {
  picks: SerializedPick[];
  date: string;
  defaultStake: number;
  /** True when picks were scored by the probability model, so EV is meaningful. */
  calibrated?: boolean;
}) {
  const pendingPicks = picks.filter((p) => p.status === "pending");
  // Offer every size the board can fill and let the economics rank them, rather
  // than assuming which size is best — that depends on your actual multipliers.
  const [basis, setBasis] = React.useState<SlipBasis>("market");
  const slips = React.useMemo(
    () => buildSuggestedSlips(pendingPicks.map(pickToSlipCandidate), [2, 3, 4, 5], { basis }),
    [pendingPicks, basis],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Suggested slips
        </CardTitle>
        <CardDescription>
          Built from the highest-confidence picks: never the same player twice, never opposite sides of one game,
          and a passer stacked with his own receiver where one is available — correlated legs raise the odds the
          whole slip lands while the multiplier stays the same. Enter your Underdog/PrizePicks lines on the picks
          before you trust the numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PricingNote />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Judge picks by</span>
          {(["market", "model"] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBasis(b)}
              className={cn(
                "rounded-md border px-2 py-1 transition-colors",
                basis === b ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {b === "market" ? "The books (recommended)" : "The model"}
            </button>
          ))}
        </div>
        {basis === "model" && (
          <p className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[11px] leading-snug text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            These slips trust the model&apos;s probabilities. So far they have scored worse than the books&apos;
            — picks it rated 8+ points above the market won 3 of 8. Treat these as the model&apos;s opinion, not an edge.
          </p>
        )}
        {slips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendingPicks.length < 2
              ? "Need at least two pending picks to suggest a slip."
              : basis === "market"
                ? "Nothing on this board beats Underdog's price by the books' own numbers. Passing is the +EV play — enter each pick's Payout in the line table if you haven't, since unpriced picks are assumed to pay a standard 1.87×."
                : "Not enough independent picks to build a slip."}
          </p>
        ) : (
          slips.map((slip) => (
            <SlipCard key={slip.size} slip={slip} date={date} defaultStake={defaultStake} calibrated={calibrated} basis={basis} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How Underdog prices an entry. It prices each pick and pays the product, so the
 * bar is set per pick, not per slip size — which retires the old "never four
 * legs" rule, a quirk of fixed ladders that Underdog's per-pick pricing does not
 * have. Shown up front because it decides which picks are worth having at all.
 */
function PricingNote() {
  const standardBar = (100 / STANDARD_PICK_PAYOUT).toFixed(1);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-snug">
      <p className="font-semibold">How the slip is priced</p>
      <p className="mt-1 text-muted-foreground">
        Underdog pays a price for each pick and the slip pays their product. A standard pick pays{" "}
        {STANDARD_PICK_PAYOUT}× and needs {standardBar}%; favourites pay less and need more. So every leg has
        to beat its own price, whatever the slip size. Enter each pick&apos;s payout in the line table and
        picks priced too short for their probability drop out of these suggestions.
      </p>
      <p className="mt-1 text-muted-foreground">
        Same-game slips pay a little under the product (1–7% so far), so type in the total Underdog shows.
      </p>
    </div>
  );
}

function SlipCard({
  slip,
  date,
  defaultStake,
  calibrated,
  basis,
}: {
  slip: SuggestedSlip;
  date: string;
  defaultStake: number;
  calibrated: boolean;
  basis: SlipBasis;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [multiplier, setMultiplier] = React.useState(String(slip.multiplier));
  const [placedReal, setPlacedReal] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const mult = Number(multiplier) || 0;
  const payout = parlayPayout(defaultStake, mult);
  const ids = slip.legs.map((l) => l.pickId);
  // Recomputed on every keystroke, so a boosted or discounted multiplier
  // immediately changes the verdict.
  // Judged by the books, the slip's value comes from the books' probabilities
  // too — the model's own numbers have scored worse than the market's.
  const useBooks = basis === "market" && slip.legs.every((l) => l.marketProb != null);
  const legProbs = slip.legs.map((l) => (useBooks ? (l.marketProb as number) : l.confidenceScore / 100));
  const econ = slipEconomics(mult, legProbs, {
    pIsCalibrated: calibrated || useBooks,
    correlatedPairs: correlatedPairsFor(slip.legs),
  });
  const kelly = econ.overconfident ? 0 : quarterKelly(mult, econ.modelPAll);
  const source = useBooks ? "books" : "model";
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const evTone =
    econ.verdict === "positive" ? "text-success" : econ.verdict === "negative" ? "text-danger" : "text-warning";

  function save() {
    setMsg(null);
    startTransition(async () => {
      const r = await createParlay({
        name: `NFL ${slip.size}-leg ${date}`,
        stake: defaultStake,
        payoutMultiplier: mult,
        pickIds: ids,
        date,
        placedReal,
      });
      if (r.ok) {
        // Mark the legs so they count in the analytics "picks I took" scope.
        // Flag only: the parlay entry already carries the stake.
        await setPicksTakenFlag(ids, true);
      }
      setMsg(
        r.ok
          ? `Saved${placedReal ? " as a real entry" : " (simulated)"}. ${ids.length} picks marked as yours.`
          : r.error ?? "Could not save.",
      );
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
        <p
          key={i}
          className={cn(
            "mt-2 flex items-start gap-1.5 text-[11px] leading-snug",
            f.tone === "good" ? "text-success" : "text-muted-foreground",
          )}
        >
          {f.tone === "good" ? (
            <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
          )}
          {f.text}
        </p>
      ))}

      <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Payout multiplier</span>
        <span className="flex items-center gap-2">
          <input
            type="number"
            step="0.05"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="h-7 w-16 rounded-md border border-border bg-input/60 px-2 text-xs"
          />
          <span className="text-muted-foreground">
            × {formatCurrency(defaultStake)} → {formatCurrency(payout.projectedPayout)}
          </span>
        </span>
        {Math.abs(slip.multiplier - slip.baseMultiplier) > 1e-9 && (
          <>
            <span />
            <span className="text-muted-foreground">
              Product of this slip&apos;s pick payouts ({Number(slip.multiplier.toFixed(3))}×), versus{" "}
              {slip.baseMultiplier}× for {slip.size} standard picks
            </span>
          </>
        )}

        <span className="text-muted-foreground">Break-even</span>
        <span>
          each leg must hit{" "}
          <span className="font-medium tabular-nums text-foreground">
            {econ.breakEvenPerLeg == null ? "—" : pct(econ.breakEvenPerLeg)}
          </span>{" "}
          <span className="text-muted-foreground">(exact, from your multiplier)</span>
        </span>

        <span className="text-muted-foreground">{source === "books" ? "Books say" : "Model says"}</span>
        <span>
          <span className="tabular-nums">{econ.modelPerLeg == null ? "—" : pct(econ.modelPerLeg)}</span> per leg ·{" "}
          <span className="tabular-nums">{pct(econ.modelPAll)}</span> all hit
          {econ.correlationUplift > 0.001 && (
            <span className="ml-1 text-success">
              (+{(econ.correlationUplift * 100).toFixed(0)}% from the stack)
            </span>
          )}
        </span>

        <span className="text-muted-foreground">Stake</span>
        <span className="tabular-nums">
          {kelly > 0 ? (
            <>
              about <span className="font-medium text-foreground">{(kelly * 100).toFixed(1)}%</span> of your bankroll{" "}
              <span className="text-muted-foreground">(¼ Kelly — full Kelly assumes the probabilities are exact)</span>
            </>
          ) : (
            <span className="text-muted-foreground">no stake — no edge by the {source}&apos;s numbers</span>
          )}
        </span>

        <span className="text-muted-foreground">Expected value</span>
        <span className={cn("font-medium tabular-nums", econ.overconfident ? "text-muted-foreground" : evTone)}>
          {econ.ev >= 0 ? "+" : ""}
          {(econ.ev * 100).toFixed(0)}%
          <span className="ml-1 font-normal text-muted-foreground">
            {econ.verdict === "positive"
              ? `— ${source} clear the bar by ${econ.cushion == null ? "" : pct(econ.cushion)}`
              : econ.verdict === "negative"
                ? "— below the bar, likely a pass"
                : "— too close to call"}
          </span>
        </span>
      </div>
      {econ.overconfident ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[11px] leading-snug text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          The model claims {econ.modelPerLeg == null ? "" : pct(econ.modelPerLeg)} per leg. Prop markets
          are priced too well for an edge that size, so this expected value is inflated. Trust the
          break-even figure and the ranking between slips, not the percentage.
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Break-even is exact. Expected value leans on confidence as a probability, which is not yet
          calibrated, so use it to choose between slips rather than as a promised return.
        </p>
      )}

      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={placedReal}
          onChange={(e) => setPlacedReal(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        I actually placed this slip on Underdog
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="secondary">
          <Link href={`/parlays?legs=${ids.join(",")}&mult=${mult}&date=${date}`}>Open in Parlay Builder</Link>
        </Button>
        <Button size="sm" onClick={save} disabled={pending || mult <= 0}>
          {pending ? "Saving…" : "Save slip"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
