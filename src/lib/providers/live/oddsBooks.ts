/**
 * Which bookmakers to request NFL props from (pure, tested).
 *
 * The Odds API bills "every group of 10 bookmakers" as one region, so naming
 * ten books costs exactly what `regions=us` did — verified on 2026-09-30: two
 * markets for one event with these ten keys cost 2 credits. That buys the two
 * pick'em venues (whose lines we compare, never average in) alongside the eight
 * sportsbooks posting NFL props that week. Caesars and Fanatics posted none in
 * the spike, so they are left out until they do.
 */
export const NFL_PROP_BOOKMAKERS = [
  "fanduel",
  "draftkings",
  "betmgm",
  "espnbet",
  "betonlineag",
  "betrivers",
  "bovada",
  "hardrockbet",
  "underdog",
  "prizepicks",
] as const;

export type OddsTarget = { bookmakers: readonly string[] } | { regions: string };

/** Regions billed for a request. */
export function regionEquivalents(target: OddsTarget): number {
  if ("regions" in target) return target.regions.split(",").filter(Boolean).length;
  return Math.ceil(target.bookmakers.length / 10);
}

/** The query fragment for a target. Refuses a list that would bill a second region. */
export function oddsTargetQuery(target: OddsTarget): string {
  if ("regions" in target) return `regions=${target.regions}`;
  if (target.bookmakers.length > 10) {
    throw new Error(`${target.bookmakers.length} bookmakers would bill as ${regionEquivalents(target)} regions`);
  }
  return `bookmakers=${target.bookmakers.join(",")}`;
}
