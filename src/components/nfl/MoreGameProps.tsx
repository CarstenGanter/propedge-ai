"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addPropToBoardAction, scoreGamePropsAction } from "@/server/actions/nfl";
import { cn } from "@/lib/utils/cn";
import type { ScoredProp } from "@/lib/addToBoard";

/**
 * Every prop fetched for one game, scored on demand and addable to the board one
 * at a time. The board keeps only the day's top N, so a whole game — often the
 * night game — can miss it despite its props being fetched and paid for. Free:
 * it scores stored props and never calls the Odds API, and adding a pick leaves
 * the rest of the board (and its closing lines) alone, unlike a re-rank.
 */
export function MoreGameProps({ date, gameId, started }: { date: string; gameId: string; started: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<ScoredProp[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [loading, startLoading] = React.useTransition();
  const [adding, setAdding] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function load() {
    setOpen(true);
    if (rows) return;
    startLoading(async () => setRows(await scoreGamePropsAction(date, gameId)));
  }

  async function add(propId: string) {
    setAdding(propId);
    setError(null);
    const r = await addPropToBoardAction(propId);
    setAdding(null);
    if (!r.ok) {
      setError(r.error ?? "Could not add that pick.");
      return;
    }
    setRows((prev) => prev?.map((x) => (x.propId === propId ? { ...x, onBoard: true } : x)) ?? prev);
    router.refresh();
  }

  if (started) return null;

  return (
    <div className="border-t border-border/60 px-4 py-3">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : load())}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span>All props in this game (free)</span>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />}
      </button>
      {open && rows && (
        <div className="mt-2 space-y-2">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No props were fetched for this game.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-medium">Pick</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Model</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Market</th>
                    <th className="pb-1.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.propId} className={cn("border-b border-border/40 last:border-0", r.out && "opacity-45")}>
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{r.playerName}</span>{" "}
                        <span className="text-muted-foreground">
                          {r.direction === "OVER" ? "Higher" : "Lower"} {r.line} {r.propType}
                          {r.out && " · OUT"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.model}%</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {r.market == null ? "—" : `${r.market}%`}
                      </td>
                      <td className="py-1.5 text-right">
                        {r.onBoard ? (
                          <span className="text-muted-foreground">On board</span>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={adding != null || r.out} onClick={() => add(r.propId)}>
                            {adding === r.propId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Add
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] leading-snug text-muted-foreground">
            Scores props already fetched this slate — no credits. Market is the books&apos; no-vig probability
            for that side; the gap between it and the model is the edge being claimed. Adding a pick puts it
            on the board with the line table and slip builder, and leaves every other pick untouched.
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
