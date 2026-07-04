import type {
  HistoricalSplitsContext,
  MarketContext,
  MatchupContext,
  NewsContext,
  PlayerStatsContext,
  ScorablePropInput,
  SentimentContext,
} from "@/types";
import { seededRng } from "./prng";

/**
 * Deterministic, clearly-labeled DEMO research. Values are generated from a
 * seed derived from the player + prop so a given demo prop always analyzes the
 * same way. This is NOT real data and every field is sourced as "Demo data".
 */

const DEMO_SOURCE = "Demo data";

function biasFor(prop: ScorablePropInput): number {
  // Give demo props a genuine, stable lean so rankings vary. ~65% of props lean
  // toward their own pick direction (the rest lean against, so some get filtered).
  const rng = seededRng(`${prop.playerName}|${prop.propType}|bias`);
  const dir = prop.direction === "OVER" ? 1 : -1;
  const favor = rng() < 0.65 ? 1 : -1;
  const magnitude = (0.05 + rng() * 0.22) * prop.line; // 5%..27% of the line
  return dir * favor * magnitude;
}

export function demoPlayerStats(prop: ScorablePropInput): PlayerStatsContext {
  const rng = seededRng(`${prop.playerName}|${prop.propType}|stats`);
  const bias = biasFor(prop);
  const center = prop.line + bias;
  const spread = Math.max(1, prop.line * (0.12 + rng() * 0.16));
  const recentGames = Array.from({ length: 10 }, () => {
    const noise = (rng() - 0.5) * 2 * spread * 1.6;
    return Math.max(0, Math.round((center + noise) * 10) / 10);
  });
  const seasonAverage = Math.round((center + (rng() - 0.5) * spread) * 10) / 10;
  const trends = ["up", "down", "steady"] as const;
  return {
    recentGames,
    seasonAverage,
    seasonMedian: seasonAverage,
    seasonStdDev: Math.round(spread * 10) / 10,
    gamesPlayed: 24 + Math.floor(rng() * 20),
    usage: Math.round((55 + rng() * 30) * 10) / 10,
    usageTrend: trends[Math.floor(rng() * 3)],
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

export function demoMatchup(prop: ScorablePropInput): MatchupContext {
  const rng = seededRng(`${prop.playerName}|${prop.opponent}|matchup`);
  const leagueSize = prop.sport === "MLB" || prop.sport === "NFL" ? 30 : 30;
  const paces = ["fast", "average", "slow"] as const;
  return {
    opponentDefenseRank: 1 + Math.floor(rng() * leagueSize),
    leagueSize,
    opponentAllowedAverage:
      Math.round((prop.line + (rng() - 0.4) * prop.line * 0.3) * 10) / 10,
    pace: paces[Math.floor(rng() * 3)],
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

export function demoNews(prop: ScorablePropInput): NewsContext {
  const rng = seededRng(`${prop.playerName}|news`);
  const statuses = ["active", "active", "active", "questionable"] as const;
  const status = statuses[Math.floor(rng() * statuses.length)];
  const boost = rng() > 0.7;
  return {
    playerStatus: status,
    teammateAbsencesBoost: boost,
    lineupConfirmed: rng() > 0.5,
    notes: boost
      ? [
          {
            summary: `Beat report (demo) notes a rotation teammate is banged up, nudging ${prop.playerName}'s projected role up.`,
            sourceName: DEMO_SOURCE,
          },
        ]
      : [],
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

export function demoMarket(prop: ScorablePropInput): MarketContext {
  const rng = seededRng(`${prop.playerName}|${prop.propType}|market`);
  const bias = biasFor(prop);
  const projection = Math.round((prop.line + bias * 0.8) * 10) / 10;
  const spread = Math.max(0.5, prop.line * 0.04);
  return {
    projection,
    comparableLines: [
      Math.round((prop.line + (rng() - 0.5) * spread * 2) * 2) / 2,
      Math.round((prop.line + (rng() - 0.5) * spread * 2) * 2) / 2,
    ],
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

export function demoSentiment(prop: ScorablePropInput): SentimentContext {
  const rng = seededRng(`${prop.playerName}|sentiment`);
  const bias = biasFor(prop);
  const score = Math.max(-1, Math.min(1, (bias / (prop.line * 0.2)) * (0.6 + rng() * 0.4)));
  return {
    score: Math.round(score * 100) / 100,
    credibleSourceCount: 1 + Math.floor(rng() * 4),
    notes: [
      {
        summary: `Aggregated demo discussion leans ${
          score > 0.1 ? "toward the over" : score < -0.1 ? "toward the under" : "mixed"
        } on this prop.`,
        sourceName: DEMO_SOURCE,
      },
    ],
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

export function demoHistorical(prop: ScorablePropInput): HistoricalSplitsContext {
  const rng = seededRng(`${prop.playerName}|${prop.opponent}|hist`);
  const bias = biasFor(prop);
  return {
    vsOpponentAverage: Math.round((prop.line + bias * 0.6 + (rng() - 0.5) * prop.line * 0.15) * 10) / 10,
    homeAway: rng() > 0.5 ? "home" : "away",
    restDays: Math.floor(rng() * 4),
    backToBack: rng() > 0.8,
    weatherConcern: (prop.sport === "MLB" || prop.sport === "NFL" || prop.sport === "Soccer") && rng() > 0.75,
    ballparkFactor: prop.sport === "MLB" ? Math.round((0.9 + rng() * 0.25) * 100) / 100 : undefined,
    source: DEMO_SOURCE,
    isDemo: true,
  };
}

/** Deterministic "actual" result for settling DEMO picks. Clearly synthetic. */
export function demoActualResult(prop: ScorablePropInput): number {
  const rng = seededRng(`${prop.playerName}|${prop.propType}|result`);
  const stats = demoPlayerStats(prop);
  const noise = (rng() - 0.5) * 2 * (stats.seasonStdDev ?? prop.line * 0.15);
  return Math.max(0, Math.round(((stats.seasonAverage ?? prop.line) + noise) * 10) / 10);
}
