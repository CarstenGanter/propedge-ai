import {
  buildConsensus,
  type ConsensusModel,
  type QuoteStatus,
  type RawQuote,
} from "@/lib/analysis/marketConsensus";
import type { NormalizedProp, VenueLines } from "@/lib/providers/live/theOddsApi";

/**
 * The market snapshot stored on each prop (PlayerProp.marketDataJson), pure.
 *
 * Version 2 keeps every version-1 key, so anything reading the old shape keeps
 * working, and adds each book's quote. Storing the quotes rather than only the
 * result means the consensus can be recomputed when the method changes, and
 * leave-one-book-out validation can run on real slates later.
 */

export interface StoredQuote {
  book: string;
  line: number;
  over: number | null;
  under: number | null;
  status: QuoteStatus;
}

export type LineSource = "feed" | "manual";

export interface MarketSnapshot {
  v: 1 | 2;
  noVigProbOver?: number;
  comparableLines?: number[];
  bookCount?: number;
  projection?: number;
  marketLine?: number;
  source?: string;
  consensus?: ConsensusModel;
  quotes?: StoredQuote[];
  venues?: VenueLines;
  /** Where PlayerProp.underdogLine came from. Absent on older rows. */
  underdogLineSource?: LineSource;
}

export function snapshotFrom(p: NormalizedProp): MarketSnapshot {
  return {
    v: 2,
    noVigProbOver: p.noVigProbOver,
    comparableLines: p.comparableLines,
    bookCount: p.bookCount,
    projection: p.projection,
    marketLine: p.line,
    source: "The Odds API",
    consensus: p.consensus,
    quotes: p.quotes?.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under, status: q.status })),
    venues: p.venues,
  };
}

export function parseSnapshot(json: string | null | undefined): MarketSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<MarketSnapshot>;
    return { ...raw, v: raw.v === 2 ? 2 : 1 };
  } catch {
    return null;
  }
}

/**
 * The consensus for a stored snapshot, recomputed from its quotes with the
 * current method so later fixes reach earlier rows. Version-1 rows have none.
 */
export function consensusOf(snap: MarketSnapshot | null): ConsensusModel | null {
  if (!snap?.consensus) return null;
  if (!snap.quotes?.length) return snap.consensus;
  const raw: RawQuote[] = snap.quotes.map((q) => ({ book: q.book, line: q.line, over: q.over, under: q.under }));
  return buildConsensus(snap.consensus.propType, raw).model ?? snap.consensus;
}

/** A copy of the stored JSON with fields replaced, preserving everything else. */
export function patchSnapshot(json: string | null | undefined, patch: Partial<MarketSnapshot>): string {
  const base = parseSnapshot(json) ?? { v: 1 as const };
  return JSON.stringify({ ...base, ...patch });
}
