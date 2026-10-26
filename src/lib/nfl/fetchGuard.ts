/**
 * The duplicate-fetch guard (decided 2026-10-26): a slate is bought once.
 * A second fetch for the same date re-buys every game (~48 credits on a
 * November Sunday, about half the month's cushion), so it runs only with an
 * explicit override. Pure; ingest.ts reads the stored slate quotes.
 */

export interface PreviousFetch {
  /** When the last slate quote for the date was fetched. */
  at: Date;
  /** Games that fetch priced. */
  games: number;
}

/** The slate fetch already made for `date`, judged by the slate date of the games it priced. */
export function previousSlateFetch(
  quotes: { eventId: string; commenceTime: Date; fetchedAt: Date }[],
  date: string,
  toSlate: (iso: string) => string,
): PreviousFetch | null {
  const forDate = quotes.filter((q) => toSlate(q.commenceTime.toISOString()) === date);
  if (forDate.length === 0) return null;
  return {
    at: new Date(Math.max(...forDate.map((q) => q.fetchedAt.getTime()))),
    games: new Set(forDate.map((q) => q.eventId)).size,
  };
}

/** Why a fetch is refused as a repeat, or null when it may run. */
export function refetchBlock(previous: PreviousFetch | null, allowRefetch: boolean): string | null {
  if (!previous || allowRefetch) return null;
  const at = previous.at.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `Already fetched for this date at ${at} Central (${previous.games} game${previous.games === 1 ? "" : "s"}). Tick "Fetch again" to buy it a second time.`;
}
