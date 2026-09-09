"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { estimateNflFetchAction, fetchNflSlateAction } from "@/server/actions/nfl";
import type { NflFetchEstimate } from "@/lib/nfl/ingest";

/**
 * Two-step fetch: first a free estimate ("13 games × 6 markets = 78 credits"),
 * then an explicit confirm before any Odds API credits are spent.
 */
export function NflFetchButton({ date, disabled }: { date: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [estimate, setEstimate] = React.useState<NflFetchEstimate | null>(null);
  const [teamPicks, setTeamPicks] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "estimating" | "fetching">("idle");
  const [msg, setMsg] = React.useState<string | null>(null);

  function estimate_() {
    setMsg(null);
    setPhase("estimating");
    startTransition(async () => {
      const e = await estimateNflFetchAction(date);
      setEstimate(e);
      setPhase("idle");
    });
  }

  function confirm() {
    if (!estimate) return;
    setPhase("fetching");
    startTransition(async () => {
      const s = await fetchNflSlateAction(date, { includeTeamPicks: teamPicks });
      const picks = s.picks ? `${s.picks.created} pick(s) from ${s.picks.evaluated} prop(s)` : "no picks generated";
      setMsg(
        s.skipped
          ? s.reason ?? "Skipped."
          : `Imported ${s.propsImported} prop(s), ${picks}.` +
              (s.error ? ` ${s.error}` : "") +
              (s.reason ? ` ${s.reason}` : "") +
              (s.creditsRemaining != null ? ` ${s.creditsRemaining} credits left.` : ""),
      );
      setEstimate(null);
      setPhase("idle");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={estimate_} disabled={disabled || pending}>
          {phase === "estimating" && pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {phase === "estimating" && pending ? "Estimating…" : "Fetch NFL slate (Odds API)"}
        </Button>
      </div>

      {estimate && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium">
                {estimate.gamesToFetch} game{estimate.gamesToFetch === 1 ? "" : "s"} × {estimate.markets.length} market
                {estimate.markets.length === 1 ? "" : "s"} = <span className="text-primary">{estimate.credits} credits</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {estimate.gamesOnSlate} game(s) on the ESPN slate, {estimate.gamesPriced} priced by The Odds API
                {estimate.gamesPriced > estimate.gamesToFetch ? ` (capped at ${estimate.gamesToFetch} by your max-games setting)` : ""}.
                {estimate.creditsKnownRemaining != null
                  ? ` ${estimate.creditsKnownRemaining} credits available → ≈${estimate.creditsAfter} after (floor ${estimate.floor}).`
                  : " Credit balance unknown until the first paid call."}
              </p>
              <p className="text-xs text-muted-foreground">Markets: {estimate.markets.join(", ")}</p>
              {estimate.reason && <p className="text-xs text-warning">{estimate.reason}</p>}
            </div>
            <button onClick={() => setEstimate(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={teamPicks}
                onChange={(e) => setTeamPicks(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-primary)]"
              />
              Also refresh moneyline team leans (~1 credit per enabled league)
            </label>
            <Button size="sm" onClick={confirm} disabled={!estimate.allowed || pending}>
              {phase === "fetching" && pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {phase === "fetching" && pending ? "Fetching + researching…" : `Confirm — spend ${estimate.credits} credits`}
            </Button>
          </div>
        </div>
      )}
      {msg && <p className="max-w-xl text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
