"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ClipboardList, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setUnderdogAvailability, setUnderdogLines, type UnderdogLineEntry } from "@/server/actions/picks";
import { cn } from "@/lib/utils/cn";
import type { SerializedPick } from "@/lib/dto";
import { pickBreakEven, STANDARD_PICK_PAYOUT, valueVerdict, VALUE_MARGIN } from "@/lib/analysis/pickemMath";
import { PRIZEPICKS_LEG_BAR } from "@/lib/analysis/venues";

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
  const [tagDraft, setTagDraft] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(picks.map((p) => [p.id, p.prop.underdogPickMultiplier?.toString() ?? ""])),
  );

  const entered = picks.filter((p) => p.prop.underdogLine != null).length;
  const absent = picks.filter((p) => p.prop.underdogAvailable === false).length;

  function markAvailability(pickId: string, available: boolean | null) {
    setMsg(null);
    startTransition(async () => {
      await setUnderdogAvailability([pickId], available);
      router.refresh();
    });
  }

  function save() {
    const entries: UnderdogLineEntry[] = [];
    for (const p of picks) {
      const entry: UnderdogLineEntry = { pickId: p.id };
      const raw = (draft[p.id] ?? "").trim();
      const line = raw === "" ? null : Number(raw);
      if ((raw === "" || Number.isFinite(line)) && line !== (p.prop.underdogLine ?? null)) entry.line = line;
      const rawTag = (tagDraft[p.id] ?? "").trim();
      const tag = rawTag === "" ? null : Number(rawTag);
      const tagValid = rawTag === "" || (Number.isFinite(tag) && (tag as number) > 0);
      if (tagValid && tag !== (p.prop.underdogPickMultiplier ?? null)) entry.pickMultiplier = tag;
      if (entry.line !== undefined || entry.pickMultiplier !== undefined) entries.push(entry);
    }
    if (entries.length === 0) {
      setMsg("No changes to save.");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const r = await setUnderdogLines(entries);
      setMsg(
        `Saved ${r.updated} pick${r.updated === 1 ? "" : "s"}.` +
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
              {absent > 0 && (
                <>
                  {" "}
                  <span className="text-warning">
                    {absent} marked not on Underdog
                  </span>{" "}
                  and excluded from slips.
                </>
              )}
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
                  <th className="pb-2 pr-3 text-right font-medium">Edge</th>
                  <th className="pb-2 pr-3 text-right font-medium" title={`What Underdog pays for this pick, e.g. 1.71. Blank = a standard ${STANDARD_PICK_PAYOUT}x pick.`}>Payout</th>
                  <th className="pb-2 pr-3 text-right font-medium" title="Hit rate this pick needs to be worth its payout: 1 ÷ payout.">Needs</th>
                  <th className="pb-2 pr-3 text-right font-medium" title="The sportsbooks' own no-vig probability for this side at your line. Green when it beats Needs.">Books</th>
                  <th className="pb-2 pr-3 text-right font-medium" title={`PrizePicks' line from the feed, and the books' probability for the side they favour there. PrizePicks pays the same either way, so a stale line pays in full; green when it clears the ${(PRIZEPICKS_LEG_BAR * 100).toFixed(1)}% a leg its 5-pick Power Play needs, by the ${Math.round((VALUE_MARGIN - 1) * 100)}% margin.`}>PrizePicks</th>
                  <th className="pb-2 text-right font-medium">On Underdog?</th>
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
                  const missing = p.prop.underdogAvailable === false;
                  return (
                    <tr
                      key={p.id}
                      className={cn("border-b border-border/40 last:border-0", missing && "opacity-45")}
                    >
                      <td className="py-2 pr-3 font-medium">
                        <span className={cn(missing && "line-through")}>{p.prop.playerName}</span>
                      </td>
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
                        {p.prop.underdogLineSource === "feed" && typed === p.prop.underdogLine && (
                          <div
                            className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                            title="Filled from Underdog via The Odds API — indicative. Edit it and save to mark it as yours; the feed never overwrites a line you typed."
                          >
                            from feed
                          </div>
                        )}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 text-right tabular-nums",
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
                        {p.prop.underdogRead && typed === p.prop.underdogLine && p.prop.underdogRead.flag !== "none" && (
                          <div
                            className={cn(
                              "mt-0.5 text-[10px] font-medium uppercase tracking-wide",
                              p.prop.underdogRead.flag === "soft" ? "text-success" : "text-danger",
                            )}
                            title={`At Underdog's line the books give this side ${(p.prop.underdogRead.probAtLine * 100).toFixed(1)}% — ${p.prop.underdogRead.flag === "soft" ? "kinder" : "harsher"} than at their own line. A soft line is the one edge that has held up.`}
                          >
                            {p.prop.underdogRead.flag} line
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <input
                          type="number"
                          step="0.05"
                          min="0.05"
                          inputMode="decimal"
                          value={tagDraft[p.id] ?? ""}
                          onChange={(e) => setTagDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                          placeholder={String(STANDARD_PICK_PAYOUT)}
                          aria-label={`Payout multiplier for ${p.prop.playerName}`}
                          className="h-8 w-16 rounded-md border border-border bg-input/60 px-2 text-right text-sm tabular-nums"
                        />
                      </td>
                      <NeedsCell pick={p} tagRaw={tagDraft[p.id] ?? ""} />
                      <PrizePicksCell pick={p} />
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => markAvailability(p.id, missing ? null : false)}
                          disabled={pending}
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50",
                            missing
                              ? "border-warning/40 bg-warning/10 text-warning"
                              : "border-border text-muted-foreground hover:border-warning/40 hover:text-warning",
                          )}
                          title={
                            missing
                              ? "Marked absent from Underdog. Click to undo."
                              : "Mark this prop as not offered on Underdog — it will be excluded from slips."
                          }
                        >
                          {missing ? "Not offered ✕" : "Not offered?"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            <strong className="font-medium text-foreground/80">Payout</strong> is what Underdog pays for
            each pick — {STANDARD_PICK_PAYOUT}× for a standard one, less for a side it rates likely, more for
            one it rates unlikely. A slip pays the product. <strong className="font-medium text-foreground/80">Needs</strong>{" "}
            is 1 ÷ payout: the hit rate that pick must reach to be worth taking, whatever the slip size.
            <strong className="font-medium text-foreground/80"> Books</strong> is what the sportsbooks say it
            will do at your line — <span className="text-success">green</span> when it already beats Needs.
            Green picks are Underdog mispricing a prop against the sharp books; that edge doesn&apos;t depend
            on the model. Most weeks few or none will be green, and that&apos;s the honest answer.
          </p>
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

/**
 * What this pick has to hit to be worth its price — one over its payout — and
 * what the sportsbooks say it will. The books are the judge here, not the
 * model: the model's own probabilities have scored worse than the market's, so
 * a pick is shown green only when the books' number already clears the price.
 * That is Underdog mispricing a pick relative to sharp books — the one edge that
 * does not depend on the model being right. The model's number is in the tooltip.
 */
function NeedsCell({ pick, tagRaw }: { pick: SerializedPick; tagRaw: string }) {
  const typed = tagRaw.trim() === "" ? null : Number(tagRaw);
  const payout = typed != null && Number.isFinite(typed) && typed > 0 ? typed : null;
  const need = pickBreakEven(payout);
  const books = pick.marketProb;
  const thin = pick.prop.marketReliable === false;
  const model = pick.scoringProfile === "distribution" ? pick.confidenceScore / 100 : null;
  const verdict = books != null ? valueVerdict(books / need) : null;
  const tip =
    (payout == null ? `Assuming a standard ${STANDARD_PICK_PAYOUT}x pick. ` : "") +
    `Needs ${(need * 100).toFixed(1)}%.` +
    (books != null ? ` Books: ${(books * 100).toFixed(1)}% (value ${(books / need).toFixed(3)}).` : " No books' price for this line.") +
    (thin ? " Fewer than three independent books priced it — too thin to call an edge." : "") +
    (model != null ? ` Model: ${(model * 100).toFixed(0)}%.` : "") +
    ` Green needs value ≥ ${VALUE_MARGIN.toFixed(2)}; amber is break-even.`;
  return (
    <>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground" title={tip}>
        {(need * 100).toFixed(1)}%
      </td>
      <td
        className={cn(
          "py-2 pr-3 text-right tabular-nums",
          verdict == null || thin
            ? "text-muted-foreground"
            : verdict === "edge"
              ? "font-medium text-success"
              : verdict === "break-even"
                ? "text-warning"
                : "text-danger",
        )}
        title={tip}
      >
        {books == null ? "—" : `${thin ? "~" : ""}${(books * 100).toFixed(1)}%`}
      </td>
    </>
  );
}

/**
 * PrizePicks' line from the feed and the side the books favour at it. Its
 * multiplier is the same whichever side you pick, so the value is simply the
 * books' probability over its per-leg bar.
 */
function PrizePicksCell({ pick }: { pick: SerializedPick }) {
  const pp = pick.prop.prizePicks;
  if (!pp) return <td className="py-2 pr-3 text-right text-muted-foreground">—</td>;
  const verdict = pick.prop.marketReliable === false ? null : valueVerdict(pp.value);
  return (
    <td
      className={cn(
        "py-2 pr-3 text-right tabular-nums",
        verdict === "edge" ? "font-medium text-success" : verdict === "break-even" ? "text-warning" : "text-muted-foreground",
      )}
      title={`PrizePicks line ${pp.line}. Books give ${pp.direction === "OVER" ? "More" : "Less"} ${(pp.prob * 100).toFixed(1)}% there (ties refunded); its 5-pick Power Play needs ${(PRIZEPICKS_LEG_BAR * 100).toFixed(1)}% a leg. Value ${pp.value.toFixed(3)}.`}
    >
      {pp.direction === "OVER" ? "More" : "Less"} {pp.line} · {(pp.prob * 100).toFixed(0)}%
    </td>
  );
}
