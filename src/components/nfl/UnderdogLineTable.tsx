"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ClipboardList, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setUnderdogLines, type UnderdogLineEntry } from "@/server/actions/picks";
import { cn } from "@/lib/utils/cn";
import type { SerializedPick } from "@/lib/dto";

/**
 * Enter the whole slate's pick'em lines at once. Scoring a pick against the
 * sportsbook consensus instead of the number Underdog/PrizePicks actually posts
 * is the difference between a real edge and a guess, and entering them one pick
 * at a time was slow enough that it never happened.
 */
export function UnderdogLineTable({ picks }: { picks: SerializedPick[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(picks.map((p) => [p.id, p.prop.underdogLine?.toString() ?? ""])),
  );

  const entered = picks.filter((p) => p.prop.underdogLine != null).length;

  function save() {
    const entries: UnderdogLineEntry[] = [];
    for (const p of picks) {
      const raw = (draft[p.id] ?? "").trim();
      const line = raw === "" ? null : Number(raw);
      if (raw !== "" && !Number.isFinite(line)) continue;
      if (line === (p.prop.underdogLine ?? null)) continue; // unchanged
      entries.push({ pickId: p.id, line });
    }
    if (entries.length === 0) {
      setMsg("No changes to save.");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await setUnderdogLines(entries);
      setMsg(
        `Saved ${r.updated} line${r.updated === 1 ? "" : "s"} and re-scored those picks.` +
          (r.failed ? ` ${r.failed} failed.` : ""),
      );
      router.refresh();
    });
  }

  if (picks.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start justify-between gap-3 text-left">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> Enter your pick&apos;em lines
            </CardTitle>
            <CardDescription className="mt-1">
              {entered} of {picks.length} picks have your line. Picks are scored against the sportsbook
              number until you enter the one Underdog actually posts.
            </CardDescription>
          </div>
          <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Player</th>
                  <th className="pb-2 pr-3 font-medium">Pick</th>
                  <th className="pb-2 pr-3 text-right font-medium">Book line</th>
                  <th className="pb-2 pr-3 text-right font-medium">Your line</th>
                  <th className="pb-2 text-right font-medium">Edge</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => {
                  const raw = (draft[p.id] ?? "").trim();
                  const typed = raw === "" ? null : Number(raw);
                  const reference = p.prop.marketLine ?? p.prop.line;
                  const liveEdge =
                    typed != null && Number.isFinite(typed)
                      ? Math.round((p.prop.direction === "OVER" ? 1 : -1) * (reference - typed) * 10) / 10
                      : null;
                  return (
                    <tr key={p.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 font-medium">{p.prop.playerName}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {p.prop.direction === "OVER" ? "Higher" : "Lower"} {p.prop.propType}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {p.prop.marketLine ?? p.prop.line}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <input
                          type="number"
                          step="0.5"
                          inputMode="decimal"
                          value={draft[p.id] ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                          placeholder="—"
                          className="h-8 w-20 rounded-md border border-border bg-input/60 px-2 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          liveEdge == null
                            ? "text-muted-foreground"
                            : liveEdge >= 0.4
                              ? "text-success"
                              : liveEdge <= -0.4
                                ? "text-danger"
                                : "text-muted-foreground",
                        )}
                      >
                        {liveEdge == null ? "—" : `${liveEdge > 0 ? "+" : ""}${liveEdge}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Edge is your line versus the market&apos;s fair value. Positive means Underdog is offering a
            softer number than the books, which is the edge worth taking. Leave a row blank to score it
            against the book line.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? "Saving & re-scoring…" : "Save lines & re-score"}
            </Button>
            {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
