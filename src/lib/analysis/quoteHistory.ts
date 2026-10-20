import type { Direction } from "@/types";
import { buildConsensus, consensusProbOver, type ConsensusModel, type RawQuote } from "./marketConsensus";

/**
 * The market as of a moment, from the odds store (pure, tested).
 *
 * The store holds every quote with the time we fetched it. "As of T" means each
 * book's quotes from its latest fetch at or before T — nothing fetched after T
 * can leak in, which is what keeps a backtest honest. A book's quotes from one
 * fetch are kept together: a book posting a main line and alternates in the
 * same fetch is one snapshot of that book.
 */

export interface StoredOddsQuote {
  book: string;
  line: number;
  over: number | null;
  under: number | null;
  fetchedAt: Date;
  bookUpdatedAt: Date | null;
}

export function quotesAsOf(quotes: StoredOddsQuote[], asOf: Date): RawQuote[] {
  const latest = new Map<string, number>();
  for (const q of quotes) {
    const t = q.fetchedAt.getTime();
    if (t > asOf.getTime()) continue;
    if (t > (latest.get(q.book) ?? -Infinity)) latest.set(q.book, t);
  }
  return quotes
    .filter((q) => latest.get(q.book) === q.fetchedAt.getTime())
    .map((q) => ({
      book: q.book,
      line: q.line,
      over: q.over,
      under: q.under,
      lastUpdate: q.bookUpdatedAt?.toISOString(),
    }));
}

/** The consensus as of `asOf`, or null when nothing usable had been fetched by then. */
export function consensusAsOf(propType: string, quotes: StoredOddsQuote[], asOf: Date): ConsensusModel | null {
  const raw = quotesAsOf(quotes, asOf);
  return raw.length ? buildConsensus(propType, raw).model : null;
}

/**
 * Entry and closing probability of one side, read at one line. CLV compares
 * the same line at two moments; reading the entry at the books' line and the
 * close at an Underdog line typed later — what happened on 2026-10-15/18 —
 * measured the line change, not market movement, and inflated average CLV
 * from +0.04 to +0.45 points.
 */
export function sideProbsAtLine(
  entry: ConsensusModel | null,
  close: ConsensusModel | null,
  line: number,
  direction: Direction,
): { entryProb: number | null; closingProb: number | null } {
  const side = (m: ConsensusModel | null) => {
    if (!m) return null;
    const over = consensusProbOver(m, line);
    return direction === "OVER" ? over : 1 - over;
  };
  return { entryProb: side(entry), closingProb: side(close) };
}
