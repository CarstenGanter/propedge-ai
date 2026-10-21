import type { Direction } from "@/types";
import { consensusSideProb, pricedAt, type ConsensusModel } from "./marketConsensus";
import { STANDARD_PICK_PAYOUT } from "./pickemMath";
import type { LineSource } from "@/lib/marketSnapshot";

/**
 * Pick'em venue lines against the sportsbook consensus (pure, tested).
 *
 * The feed carries Underdog's and PrizePicks' LINES; their prices are
 * placeholders (every quote came back at -137 in the 2026-09-30 spike). So a
 * venue's line is read against the consensus, and the payout stays whatever
 * the user entered — or standard when they haven't.
 */

// ---- Underdog: filling the line from the feed ----

export interface UnderdogLineState {
  line: number | null;
  source: LineSource | null;
}

/**
 * Merge a freshly fetched Underdog line with what is stored. A line the user
 * typed is never overwritten — including lines typed before sources were
 * recorded, which count as manual. The feed fills blanks and refreshes its own
 * earlier values; a missing feed quote never clears a line.
 */
export function mergeUnderdogLine(prev: UnderdogLineState, feedLine: number | undefined): UnderdogLineState {
  const manual = prev.source === "manual" || (prev.source == null && prev.line != null);
  if (manual) return { line: prev.line, source: "manual" };
  if (feedLine != null) return { line: feedLine, source: "feed" };
  return prev.line != null ? { line: prev.line, source: "feed" } : { line: null, source: null };
}

/**
 * Seeing a prop in the feed says Underdog offers it; not seeing it says
 * nothing (discounted picks are missing from the base market). A user's
 * explicit "not offered" is kept.
 */
export function mergeAvailability(prev: boolean | null, feedLine: number | undefined): boolean | null {
  if (prev === false) return false;
  if (feedLine != null) return true;
  return prev;
}

/**
 * Whether Underdog's prices in a fetch look like real payouts. On every slate
 * stored from 2026-10-01 to 10-15, each Underdog quote in the main markets came
 * back at one placeholder price on both sides (-137), so payouts are typed by
 * hand. Real payouts vary by player and side; one price repeated everywhere
 * does not. Null when the fetch carried no Underdog prices at all.
 */
export function underdogPricesLookReal(quotes: { book: string; over: number | null; under: number | null }[]): boolean | null {
  const prices = new Set<number>();
  for (const q of quotes) {
    if (q.book !== "underdog") continue;
    if (q.over != null) prices.add(q.over);
    if (q.under != null) prices.add(q.under);
  }
  return prices.size === 0 ? null : prices.size > 1;
}

// ---- Reading a venue line against the market ----

export type LineFlag = "soft" | "tough" | "none";

/** A venue line this much kinder (in probability) than the books' own line counts as soft. */
export const SOFT_LINE_THRESHOLD = 0.015;

export interface VenueRead {
  line: number;
  /** Venue line minus the books' reference line. */
  lineGap: number;
  /** Books' probability that `dir` wins at the venue's line (ties refunded). */
  probAtVenue: number;
  /** The same at the books' own line. */
  probAtReference: number;
  flag: LineFlag;
  /** False when the venue line is beyond what the books posted: probAtVenue is then an extrapolation. */
  priced: boolean;
}

export function readVenueLine(m: ConsensusModel, venueLine: number, dir: Direction): VenueRead {
  const probAtVenue = consensusSideProb(m, venueLine, dir);
  const probAtReference = consensusSideProb(m, m.referenceLine, dir);
  const diff = probAtVenue - probAtReference;
  const priced = pricedAt(m, venueLine);
  return {
    line: venueLine,
    lineGap: venueLine - m.referenceLine,
    probAtVenue,
    probAtReference,
    // An extrapolated probability can't call a line soft or tough either.
    flag: !priced ? "none" : diff >= SOFT_LINE_THRESHOLD ? "soft" : diff <= -SOFT_LINE_THRESHOLD ? "tough" : "none",
    priced,
  };
}

/** Books' probability x Underdog's payout (standard when not entered). */
export function underdogValue(read: VenueRead, payout: number | null | undefined): number {
  const pay = payout != null && payout > 0 ? payout : STANDARD_PICK_PAYOUT;
  return read.probAtVenue * pay;
}

// ---- PrizePicks: fixed multipliers ----

/**
 * PrizePicks pays the same multiplier whichever side you pick, so its per-leg
 * bar is fixed by the entry size. Its 5-pick Power Play (20x) is the cheapest
 * common size: 20^(-1/5) ≈ 54.9% a leg. That is exactly why a stale line
 * matters there — the favoured side is paid in full.
 */
export const PRIZEPICKS_LEG_BAR = 20 ** (-1 / 5);

/** Books' probability over PrizePicks' per-leg bar: above 1, the leg carries positive value. */
export function prizePicksValue(read: VenueRead): number {
  return read.probAtVenue / PRIZEPICKS_LEG_BAR;
}

/** Whichever side the books favour at PrizePicks' line — the one worth playing there. */
export function bestPrizePicksSide(m: ConsensusModel, ppLine: number): { dir: Direction; read: VenueRead } {
  const over = readVenueLine(m, ppLine, "OVER");
  const under = readVenueLine(m, ppLine, "UNDER");
  return over.probAtVenue >= under.probAtVenue ? { dir: "OVER", read: over } : { dir: "UNDER", read: under };
}

/**
 * When the Underdog line changes — set, moved or cleared — record the time and
 * where it came from (pure). An unchanged line keeps its original stamp, so a
 * refresh never makes an old line look new.
 */
export function underdogLineStamp(
  prev: { line: number | null },
  next: { line: number | null; source: LineSource | null },
  now: Date,
): { underdogLineAt: Date | null; underdogLineSource: LineSource | null } | Record<string, never> {
  if (prev.line === next.line) return {};
  if (next.line == null) return { underdogLineAt: null, underdogLineSource: null };
  return { underdogLineAt: now, underdogLineSource: next.source };
}
