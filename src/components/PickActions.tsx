"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Coins, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { setPickBet } from "@/server/actions/bankroll";
import { updatePickNote } from "@/server/actions/picks";
import { formatCurrency } from "@/lib/utils/format";

export function BetControls({
  pickId,
  defaultStake,
  hasBet,
  placedReal,
}: {
  pickId: string;
  defaultStake: number;
  hasBet: boolean;
  placedReal: boolean;
}) {
  const router = useRouter();
  const [stake, setStake] = React.useState(String(defaultStake));
  const [real, setReal] = React.useState(placedReal);
  const [pending, startTransition] = React.useTransition();

  function bet(mode: "single" | "none") {
    startTransition(async () => {
      await setPickBet({
        pickId,
        mode,
        stake: Number(stake) || defaultStake,
        placedReal: real,
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Bankroll (simulated)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-border bg-input/60 px-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            step="0.5"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="h-9 w-20 border-0 bg-transparent px-1"
          />
        </div>
        <Button size="sm" onClick={() => bet("single")} disabled={pending}>
          {hasBet ? "Update single bet" : "Track as single bet"}
        </Button>
        {hasBet && (
          <Button size="sm" variant="ghost" onClick={() => bet("none")} disabled={pending}>
            Remove bet
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={real}
          onChange={(e) => setReal(e.target.checked)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        I actually placed this entry ({formatCurrency(Number(stake) || defaultStake)})
      </label>
    </div>
  );
}

export function PickNoteEditor({ pickId, initial }: { pickId: string; initial: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState(initial);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function save() {
    startTransition(async () => {
      await updatePickNote(pickId, note);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StickyNote className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">My notes</span>
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add your own read before or after the game…"
      />
      <Button size="sm" variant="secondary" onClick={save} disabled={pending}>
        {saved ? <><Check className="h-4 w-4" /> Saved</> : pending ? "Saving…" : "Save note"}
      </Button>
    </div>
  );
}
