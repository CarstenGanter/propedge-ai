import "server-only";
import { prisma } from "@/lib/db/client";
import type { FetchedQuote } from "@/lib/providers/live/theOddsApi";
import { consensusAsOf, type StoredOddsQuote } from "@/lib/analysis/quoteHistory";
import type { ConsensusModel } from "@/lib/analysis/marketConsensus";

/**
 * The odds store: every fetched quote, appended with its fetch time. The slate
 * and closing quotes cost nothing extra — they keep what those fetches already
 * buy. Alternate ladders ("alt") are a paid addition: one credit per game per
 * alternate market, shown in the fetch estimate.
 */

export type FetchKind = "slate" | "closing" | "alt";

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function saveQuotes(quotes: FetchedQuote[], fetchedAt: Date, fetchKind: FetchKind): Promise<number> {
  if (quotes.length === 0) return 0;
  const data = quotes.map((q) => ({
    fetchedAt,
    fetchKind,
    sportKey: q.sportKey,
    eventId: q.eventId,
    commenceTime: new Date(q.commenceTime),
    homeTeam: q.homeTeam,
    awayTeam: q.awayTeam,
    playerName: q.playerName,
    propType: q.propType,
    book: q.book,
    line: q.line,
    over: q.over,
    under: q.under,
    bookUpdatedAt: toDate(q.lastUpdate),
  }));
  // SQLite caps bound parameters per statement; batch to stay well under it.
  for (let i = 0; i < data.length; i += 500) await prisma.oddsQuote.createMany({ data: data.slice(i, i + 500) });
  return data.length;
}

/** Every stored quote for one player prop in one event. */
export async function quoteHistory(eventId: string, playerName: string, propType: string): Promise<StoredOddsQuote[]> {
  return prisma.oddsQuote.findMany({
    where: { eventId, playerName, propType },
    select: { book: true, line: true, over: true, under: true, fetchedAt: true, bookUpdatedAt: true },
    orderBy: { fetchedAt: "asc" },
  });
}

/** The consensus for one prop as of `asOf`, from the store. */
export async function storedConsensusAsOf(
  eventId: string,
  playerName: string,
  propType: string,
  asOf: Date,
): Promise<ConsensusModel | null> {
  return consensusAsOf(propType, await quoteHistory(eventId, playerName, propType), asOf);
}
