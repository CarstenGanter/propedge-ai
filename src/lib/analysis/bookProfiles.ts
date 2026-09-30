/**
 * How much each bookmaker's prop price counts toward the market consensus
 * (pure). Props have no single sharp book, so this is a weighting, not a pick
 * of one source.
 *
 * Starting weights follow the research: FanDuel and Caesars originate their
 * own NFL prop numbers and move them aggressively; BetOnline is sharp-leaning
 * and early; the rest are large regulated books that largely follow. Books in
 * the same `group` share a pricing source and count once toward "independent
 * books". Pick'em sites are `dfs`: their lines are read as venues to compare,
 * never as part of the market they are compared against. Retune from the
 * leave-one-book-out results (src/jobs/research/validateConsensus.ts).
 */

export type BookRole = "sportsbook" | "dfs";

export interface BookProfile {
  weight: number;
  group: string;
  role: BookRole;
}

export const BOOK_PROFILES: Record<string, BookProfile> = {
  fanduel: { weight: 1.5, group: "fanduel", role: "sportsbook" },
  williamhill_us: { weight: 1.5, group: "caesars", role: "sportsbook" },
  betonlineag: { weight: 1.2, group: "betonline", role: "sportsbook" },
  lowvig: { weight: 1.2, group: "betonline", role: "sportsbook" },
  draftkings: { weight: 1.0, group: "draftkings", role: "sportsbook" },
  betmgm: { weight: 1.0, group: "betmgm", role: "sportsbook" },
  fanatics: { weight: 1.0, group: "fanatics", role: "sportsbook" },
  espnbet: { weight: 0.9, group: "espnbet", role: "sportsbook" },
  betrivers: { weight: 0.8, group: "kambi", role: "sportsbook" },
  ballybet: { weight: 0.8, group: "kambi", role: "sportsbook" },
  betparx: { weight: 0.8, group: "kambi", role: "sportsbook" },
  hardrockbet: { weight: 0.8, group: "hardrock", role: "sportsbook" },
  bovada: { weight: 0.7, group: "bovada", role: "sportsbook" },
  underdog: { weight: 0, group: "underdog", role: "dfs" },
  prizepicks: { weight: 0, group: "prizepicks", role: "dfs" },
  pick6: { weight: 0, group: "pick6", role: "dfs" },
  dabble_us_dfs: { weight: 0, group: "dabble", role: "dfs" },
};

/** A book not in the table still counts, a little, as its own group. */
export function profileFor(book: string): BookProfile {
  return BOOK_PROFILES[book] ?? { weight: 0.5, group: book, role: "sportsbook" };
}
