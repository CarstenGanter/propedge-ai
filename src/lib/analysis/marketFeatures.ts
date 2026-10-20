import type { Direction } from "@/types";
import { profileFor } from "./bookProfiles";
import { buildConsensus, STALE_QUOTE_MS, type RawQuote } from "./marketConsensus";

/**
 * Where a venue line sits against the market, and how much to trust the market
 * there (pure, tested). Features only: nothing here changes a probability.
 *
 * In σ units the same 2-yard gap means more on a low-spread prop than a high
 * one. The σ is the consensus's own (currently the CV prior × the line), so
 * these read the same as the Books column; they move with it when that σ is
 * refitted. Every gap is also given in stat units.
 */

export interface MarketFeatures {
  /**
   * The books' reference line minus the venue line, signed so + = easier for
   * the side, in consensus σ. Measured from the posted line, not the fair
   * line: on a count prop the fair line of a discrete distribution sits on a
   * whole number, which would show a 0.5 gap where the lines agree.
   */
  venueGapSigma: number | null;
  /** The same in stat units. */
  venueGapUnits: number | null;
  /** Spread of the independent book groups' implied means, in consensus σ. Wide = someone is stale. */
  groupDispersion: number | null;
  /** Age of the oldest quote behind the consensus at fetch time, minutes. Null without book timestamps. */
  oldestQuoteMinutes: number | null;
  /** Book groups whose freshest quote is over STALE_QUOTE_MS older than the freshest overall. */
  staleGroups: string[];
}

export function marketFeatures(input: {
  propType: string;
  quotes: RawQuote[];
  venueLine?: number | null;
  direction?: Direction | null;
  /** When the quotes were fetched; the freshest book timestamp stands in when absent. */
  fetchedAt?: Date | null;
}): MarketFeatures | null {
  const { model, quotes } = buildConsensus(input.propType, input.quotes);
  if (!model) return null;
  const used = quotes.filter((q) => q.status === "used" && q.impliedMean != null);

  // --- venue gap ---
  let venueGapUnits: number | null = null;
  if (input.venueLine != null && input.direction) {
    const easier = input.direction === "OVER" ? model.referenceLine - input.venueLine : input.venueLine - model.referenceLine;
    venueGapUnits = easier;
  }
  const venueGapSigma = venueGapUnits != null && model.sigma > 0 ? venueGapUnits / model.sigma : null;

  // --- dispersion across independent groups ---
  const groups = new Map<string, { w: number; m: number }>();
  for (const q of used) {
    const g = profileFor(q.book).group;
    const w = q.weight || 1;
    const cur = groups.get(g) ?? { w: 0, m: 0 };
    cur.m = (cur.m * cur.w + q.impliedMean! * w) / (cur.w + w);
    cur.w += w;
    groups.set(g, cur);
  }
  let groupDispersion: number | null = null;
  if (groups.size >= 2 && model.sigma > 0) {
    const gs = [...groups.values()];
    const total = gs.reduce((a, g) => a + g.w, 0);
    const mean = gs.reduce((a, g) => a + g.w * g.m, 0) / total;
    const variance = gs.reduce((a, g) => a + g.w * (g.m - mean) ** 2, 0) / total;
    groupDispersion = Math.sqrt(variance) / model.sigma;
  }

  // --- staleness ---
  const stamped = used.filter((q) => q.lastUpdate).map((q) => ({ group: profileFor(q.book).group, t: Date.parse(q.lastUpdate!) }));
  let oldestQuoteMinutes: number | null = null;
  const staleGroups: string[] = [];
  if (stamped.length > 0) {
    const freshest = Math.max(...stamped.map((s) => s.t));
    const reference = input.fetchedAt ? input.fetchedAt.getTime() : freshest;
    oldestQuoteMinutes = Math.max(0, (reference - Math.min(...stamped.map((s) => s.t))) / 60_000);
    const freshestByGroup = new Map<string, number>();
    for (const s of stamped) freshestByGroup.set(s.group, Math.max(freshestByGroup.get(s.group) ?? -Infinity, s.t));
    for (const [g, t] of freshestByGroup) if (freshest - t > STALE_QUOTE_MS) staleGroups.push(g);
    staleGroups.sort();
  }

  return { venueGapSigma, venueGapUnits, groupDispersion, oldestQuoteMinutes, staleGroups };
}
