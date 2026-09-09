"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { setPickTaken } from "@/server/actions/bankroll";
import { cn } from "@/lib/utils/cn";

/**
 * One-click "I took this pick". Records it against your own results so the
 * Analytics "My picks" scope can score how you actually did, separately from
 * the model's full board.
 */
export function TrackPickButton({
  pickId,
  taken,
  stake,
  className,
}: {
  pickId: string;
  taken: boolean;
  stake?: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Flips immediately on click and reverts by itself if the write fails, since
  // the optimistic value is discarded once the transition settles.
  const [on, setOn] = React.useOptimistic(taken);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !taken;
    startTransition(async () => {
      setOn(next);
      await setPickTaken({ pickId, taken: next, stake });
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      title={on ? "You marked this as a pick you took. Click to undo." : "Mark this as a pick you took"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-60",
        on
          ? "border-success/40 bg-success/12 text-success"
          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : on ? (
        <Check className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      {on ? "On my slip" : "I took this"}
    </button>
  );
}
