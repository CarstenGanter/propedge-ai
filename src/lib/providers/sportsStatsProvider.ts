import type {
  MatchupContext,
  PlayerStatsContext,
  ScorablePropInput,
} from "@/types";
import { demoMatchup, demoPlayerStats } from "./demoData";
import { getMlbPlayerStats } from "./live/mlbStats";
import { getMlbMatchup } from "./live/mlbMatchup";
import type { ProviderContext } from "./config";

/**
 * Player stats & matchup provider.
 *
 * - Demo mode returns deterministic labeled demo data.
 * - Live mode is a documented seam: resolving player game logs across sports
 *   requires athlete-id lookups that vary by source. Until wired to a keyed
 *   provider (e.g. SportsDataIO/balldontlie), live enrichment returns undefined
 *   so the scoring engine transparently records "insufficient data".
 */
export interface SportsStatsProvider {
  getPlayerStats(prop: ScorablePropInput): Promise<PlayerStatsContext | undefined>;
  getMatchup(prop: ScorablePropInput): Promise<MatchupContext | undefined>;
}

export const demoStatsProvider: SportsStatsProvider = {
  async getPlayerStats(prop) {
    return demoPlayerStats(prop);
  },
  async getMatchup(prop) {
    return demoMatchup(prop);
  },
};

export const liveStatsProvider: SportsStatsProvider = {
  async getPlayerStats(prop) {
    // MLB: free MLB Stats API game logs. Other sports: not wired yet.
    if (prop.sport === "MLB") {
      return getMlbPlayerStats(prop.playerName, prop.propType);
    }
    return undefined;
  },
  async getMatchup(prop) {
    if (prop.sport === "MLB" && prop.date) {
      return getMlbMatchup(prop.playerName, prop.propType, prop.date);
    }
    return undefined;
  },
};

export function getStatsProvider(ctx: ProviderContext): SportsStatsProvider {
  return ctx.demo ? demoStatsProvider : liveStatsProvider;
}
