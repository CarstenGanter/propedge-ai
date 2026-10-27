import { americanToProb, devig, JUICE_LIMIT, type RawQuote } from "./marketConsensus";
import { profileFor } from "./bookProfiles";

/**
 * The books' P(over) at a venue line read only from books that posted exactly
 * that line — no spread curve, so nothing is interpolated or extrapolated.
 * Each two-sided sportsbook quote at the line is de-vigged on its own and
 * weighted as the consensus weights it (the book's weight, split across the
 * members of its pricing group that posted). Pick'em sites are venues, never
 * the market, and a quote past the consensus's juice limit is left out as it
 * is there. Null when no book posted the line.
 */
export function exactLineProbOver(quotes: RawQuote[], line: number): number | null {
  const at = quotes.filter(
    (q) =>
      q.line === line &&
      q.over != null &&
      q.under != null &&
      profileFor(q.book).role !== "dfs" &&
      americanToProb(q.over) <= JUICE_LIMIT &&
      americanToProb(q.under) <= JUICE_LIMIT,
  );
  if (at.length === 0) return null;
  const groupSize = new Map<string, number>();
  for (const q of at) groupSize.set(profileFor(q.book).group, (groupSize.get(profileFor(q.book).group) ?? 0) + 1);
  let sum = 0;
  let total = 0;
  for (const q of at) {
    const p = profileFor(q.book);
    const w = p.weight / (groupSize.get(p.group) ?? 1);
    sum += w * devig(q.over!, q.under!);
    total += w;
  }
  return total > 0 ? sum / total : at.reduce((s, q) => s + devig(q.over!, q.under!), 0) / at.length;
}
