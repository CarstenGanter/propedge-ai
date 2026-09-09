import type {
  MatchupContext,
  PlayerStatsContext,
  ScorablePropInput,
} from "@/types";
import { demoMatchup, demoPlayerStats } from "./demoData";
import { getMlbPlayerStats } from "./live/mlbStats";
import { getMlbMatchup } from "./live/mlbMatchup";
import { getEspnPlayerStats } from "./live/espnPlayerStats";
import { getEspnMatchup } from "./live/espnMatchup";
import type { ProviderContext } from "./config";

/**
 * Player stats & matchup provider.
 *
 * - Demo mode returns deterministic labeled demo data.
 * - Live mode uses free public game logs: MLB Stats API for MLB, ESPN athlete
 *   gamelogs for NBA/WNBA/NFL/NHL/NCAAB. Anything unresolved returns undefined
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
    // MLB: MLB Stats API game logs. Other sports: ESPN athlete gamelogs.
    if (prop.sport === "MLB") {
      return getMlbPlayerStats(prop.playerName, prop.propType);
    }
    return getEspnPlayerStats(prop.sport, prop.playerName, prop.team, prop.opponent, prop.propType, prop.date);
  },
  async getMatchup(prop) {
    if (prop.sport === "MLB" && prop.date) {
      return getMlbMatchup(prop.playerName, prop.propType, prop.date);
    }
    // NFL: opponent defense vs this stat family from aggregated ESPN box scores.
    if (prop.sport === "NFL") {
      const { getNflMatchup } = await import("./live/nflMatchup"); // server-only deps → lazy
      return getNflMatchup(prop);
    }
    return getEspnMatchup(prop);
  },
};

export function getStatsProvider(ctx: ProviderContext): SportsStatsProvider {
  return ctx.demo ? demoStatsProvider : liveStatsProvider;
}
