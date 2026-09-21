/**
 * Which markets the pick'em platform actually posts (pure, tested).
 *
 * Props are fetched from The Odds API, a sportsbook feed. Sportsbooks carry
 * markets and players that Underdog and PrizePicks do not, so a board built
 * straight from that feed can recommend bets you cannot place — and every
 * market costs a credit per game whether or not a single prop in it is
 * playable.
 *
 * Nothing here guesses at a platform's catalogue. It only counts observations
 * the user recorded while looking at the app, which is why a market needs a
 * meaningful number of them before this will suggest dropping it.
 */

export interface AvailabilityInput {
  propType: string;
  /** null = never checked, true = seen on the platform, false = confirmed absent. */
  available: boolean | null;
}

export interface MarketAvailability {
  propType: string;
  /** Props checked either way. Unchecked props are not evidence. */
  checked: number;
  offered: number;
  missing: number;
  /** Share of checked props the platform posted, or null if none checked. */
  offeredRate: number | null;
  /** Enough observations to act on. */
  conclusive: boolean;
  /** Never once seen, across enough checks to mean something. */
  recommendDrop: boolean;
}

/**
 * Observations needed before a market's absence is worth acting on. Set where
 * a run of misses stops being plausible bad luck: if a market really is posted
 * half the time, eight straight absences happen under 0.4% of the time.
 */
export const MIN_OBSERVATIONS = 8;

export function summarizeAvailability(rows: AvailabilityInput[]): MarketAvailability[] {
  const byType = new Map<string, { offered: number; missing: number }>();
  for (const r of rows) {
    if (r.available == null) continue; // unchecked is not evidence either way
    const cur = byType.get(r.propType) ?? { offered: 0, missing: 0 };
    if (r.available) cur.offered++;
    else cur.missing++;
    byType.set(r.propType, cur);
  }
  return [...byType.entries()]
    .map(([propType, { offered, missing }]) => {
      const checked = offered + missing;
      const conclusive = checked >= MIN_OBSERVATIONS;
      return {
        propType,
        checked,
        offered,
        missing,
        offeredRate: checked > 0 ? offered / checked : null,
        conclusive,
        // Deliberately strict: only a market that has never once appeared is
        // worth dropping. One that shows up occasionally still carries value,
        // and a rate-based threshold would quietly discard real picks.
        recommendDrop: conclusive && offered === 0,
      };
    })
    .sort((a, b) => b.checked - a.checked || a.propType.localeCompare(b.propType));
}

/** Markets that have never been seen on the platform, and so are wasted credits. */
export function marketsToDrop(rows: AvailabilityInput[]): string[] {
  return summarizeAvailability(rows)
    .filter((m) => m.recommendDrop)
    .map((m) => m.propType);
}

/**
 * Credits saved per slate by dropping those markets, at one credit per market
 * per game — the Odds API's per-event pricing.
 */
export function creditsSavedPerSlate(droppedMarkets: number, gamesOnSlate: number): number {
  if (droppedMarkets <= 0 || gamesOnSlate <= 0) return 0;
  return droppedMarkets * gamesOnSlate;
}
