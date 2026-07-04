"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setTeamBet, settleTeamPickManually } from "@/server/actions/teams";
import { moneylinePayout } from "@/lib/settlement";
import { formatCurrency, formatSignedCurrency } from "@/lib/utils/format";
import type { SerializedTeamPick } from "@/lib/dto";
import type { TeamSide } from "@/types";

export function TeamBetControls({
  pick,
  defaultStake,
  hasBet,
  placedReal,
}: {
  pick: SerializedTeamPick;
  defaultStake: number;
  hasBet: boolean;
  placedReal: boolean;
}) {
  const router = useRouter();
  const [stake, setStake] = React.useState(String(defaultStake));
  const [real, setReal] = React.useState(placedReal);
  const [pending, startTransition] = React.useTransition();

  const stakeNum = Number(stake) || defaultStake;
  const profit = pick.priceAmerican != null ? moneylinePayout(stakeNum, pick.priceAmerican) : stakeNum;

  function bet(mode: "moneyline" | "none") {
    startTransition(async () => {
      await setTeamBet({ teamPickId: pick.id, mode, stake: stakeNum, placedReal: real });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Moneyline bet (simulated)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-border bg-input/60 px-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            step="1"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="h-9 w-20 border-0 bg-transparent px-1"
          />
        </div>
        <Button size="sm" onClick={() => bet("moneyline")} disabled={pending}>
          {hasBet ? "Update bet" : "Track bet"}
        </Button>
        {hasBet && (
          <Button size="sm" variant="ghost" onClick={() => bet("none")} disabled={pending}>
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {pick.priceAmerican != null
          ? `At ${pick.priceAmerican > 0 ? "+" : ""}${pick.priceAmerican}: win ${formatSignedCurrency(profit)} · risk ${formatCurrency(stakeNum)}`
          : `Even-money assumed: win ${formatSignedCurrency(profit)}`}
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
        I actually placed this bet
      </label>
    </div>
  );
}

export function TeamSettlementModal({
  pick,
  trigger,
}: {
  pick: SerializedTeamPick;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const isSoccer = pick.recommendedSide === "DRAW" || pick.tags.includes("draw risk") || pick.warnings.some((w) => /draw/i.test(w));

  function settle(winner?: TeamSide, status?: "push" | "void") {
    startTransition(async () => {
      await settleTeamPickManually({ id: pick.id, winner, status });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            Settle
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle game</DialogTitle>
          <DialogDescription>
            {pick.awayTeam} @ {pick.homeTeam} · your pick: {pick.recommendedTeam} to win
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Who won?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => settle("HOME")} disabled={pending}>
              {pick.homeTeam} won
            </Button>
            <Button size="sm" variant="secondary" onClick={() => settle("AWAY")} disabled={pending}>
              {pick.awayTeam} won
            </Button>
            {isSoccer && (
              <Button size="sm" variant="secondary" onClick={() => settle("DRAW")} disabled={pending}>
                Draw
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => settle(undefined, "push")} disabled={pending}>
            Push
          </Button>
          <Button variant="ghost" size="sm" onClick={() => settle(undefined, "void")} disabled={pending}>
            Void / No action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
