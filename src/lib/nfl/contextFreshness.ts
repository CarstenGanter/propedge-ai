/** How long a fetched game context (injury report, odds, weather) counts as current. */
export const CONTEXT_TTL = 30 * 60 * 1000;

/**
 * Whether a context is fresh enough to read "not on the report" as "no
 * designation". A failed fetch falls back to the cached context of any age,
 * so a Wednesday report could otherwise stand in for Friday's (pure).
 */
export function isFreshContext(fetchedAt: string, now: Date = new Date(), ttlMs: number = CONTEXT_TTL): boolean {
  const t = Date.parse(fetchedAt);
  return Number.isFinite(t) && now.getTime() - t <= ttlMs;
}
