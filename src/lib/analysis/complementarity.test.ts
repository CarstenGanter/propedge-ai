import { describe, expect, it } from "vitest";
import { analyzeProp } from "./scoringEngine";
import { computeUnderdogEdge, type SerializedProp } from "@/lib/dto";
import {
  CATEGORY_WEIGHTS,
  MARKET_PROFILE_WEIGHTS,
  type Direction,
  type ResearchBundle,
  type ScorablePropInput,
} from "@/types";

/**
 * The two sides of one prop are complementary events, so their confidence
 * scores must sum to 100. Any term that pushes both sides the same way — a
 * direction-blind bonus, or an asymmetric one — breaks that and silently
 * inflates every pick. This is the cheapest regression guard in the codebase.
 */

const prop: ScorablePropInput = {
  sport: "NFL",
  league: "NFL",
  playerName: "Test Player",
  team: "Home Team",
  opponent: "Away Team",
  propType: "Receptions",
  line: 4.5,
  marketLine: 4.5,
  direction: "OVER",
  date: "2026-09-13",
};

/** The market's view of a side has to flip with the side. */
function bundleFor(direction: Direction, over: Partial<ResearchBundle> = {}): ResearchBundle {
  const base: ResearchBundle = {
    playerStats: {
      recentGames: [7, 5, 6, 4, 8, 5, 6, 3, 7, 5],
      seasonAverage: 5.6,
      seasonStdDev: 1.6,
      gamesPlayed: 10,
      usage: 8,
      usageTrend: "up",
      currentSeasonGames: 10,
      source: "ESPN gamelog",
    },
    matchup: {
      opponentDefenseRank: 25,
      leagueSize: 32,
      pace: "fast",
      // Provider signs this for the pick's direction, so flip it with the side.
      environmentFavor: direction === "OVER" ? 0.4 : -0.4,
      source: "ESPN box scores",
    },
    news: { playerStatus: "questionable", teammateAbsencesBoost: true, lineupConfirmed: true, source: "ESPN" },
    market: { noVigProbOver: 0.57, marketLine: 4.5, bookCount: 5, source: "The Odds API" },
    historical: { homeAway: "home", restDays: 7, weatherConcern: true, weatherNote: "Windy.", source: "Open-Meteo" },
    ...over,
  };
  return base;
}

describe("a prop's two sides sum to 100", () => {
  const sides = (p: ScorablePropInput, extra?: Partial<ResearchBundle>) => {
    const over = analyzeProp({ ...p, direction: "OVER" }, bundleFor("OVER", extra));
    const under = analyzeProp({ ...p, direction: "UNDER" }, bundleFor("UNDER", extra));
    return { over: over.confidenceScore, under: under.confidenceScore };
  };

  it("holds for a fully-populated bundle", () => {
    const { over, under } = sides(prop);
    expect(over + under).toBeGreaterThanOrEqual(99); // ±1 for rounding
    expect(over + under).toBeLessThanOrEqual(101);
  });

  it("holds when the player is doubtful", () => {
    const { over, under } = sides(prop, { news: { playerStatus: "doubtful", source: "ESPN" } });
    expect(over + under).toBeGreaterThanOrEqual(99);
    expect(over + under).toBeLessThanOrEqual(101);
  });

  it("treats availability directionally: doubtful hurts the over and helps the under", () => {
    // Isolated, so the other categories can't drown the availability signal.
    const news = { news: { playerStatus: "doubtful" as const, source: "ESPN" } };
    const over = analyzeProp({ ...prop, direction: "OVER" }, news);
    const under = analyzeProp({ ...prop, direction: "UNDER" }, news);
    expect(over.scoreBreakdown.injuryNews).toBe(28);
    expect(under.scoreBreakdown.injuryNews).toBe(72);
    expect(under.confidenceScore).toBeGreaterThan(over.confidenceScore);
    expect(over.confidenceScore + under.confidenceScore).toBe(100);
  });

  it("holds when weather is flagged and teammates are out", () => {
    const { over, under } = sides(prop, {
      news: { teammateAbsencesBoost: true, source: "ESPN" },
      historical: { weatherConcern: true, weatherNote: "Wind 20mph.", source: "Open-Meteo" },
    });
    expect(over + under).toBeGreaterThanOrEqual(99);
    expect(over + under).toBeLessThanOrEqual(101);
  });

  it("holds with an empty bundle", () => {
    const over = analyzeProp({ ...prop, direction: "OVER" }, {});
    const under = analyzeProp({ ...prop, direction: "UNDER" }, {});
    expect(over.confidenceScore + under.confidenceScore).toBe(100);
  });

  it("gives no credit for merely carrying no injury designation", () => {
    const active = analyzeProp(prop, bundleFor("OVER", { news: { playerStatus: "active", source: "ESPN" } }));
    const silent = analyzeProp(prop, bundleFor("OVER", { news: undefined }));
    expect(active.scoreBreakdown.injuryNews).toBe(50);
    expect(silent.scoreBreakdown.injuryNews).toBe(50);
  });

  it("keeps parlay suitability out of the confidence blend but still reports it", () => {
    // Volatility and data completeness say nothing about which side wins, so the
    // category carries no weight — while remaining visible for slip building.
    expect(CATEGORY_WEIGHTS.parlaySuitability).toBe(0);
    expect(MARKET_PROFILE_WEIGHTS.parlaySuitability).toBe(0);
    const a = analyzeProp(prop, bundleFor("OVER"));
    expect(a.scoreBreakdown.parlaySuitability).toBeGreaterThan(0);
  });

  it("every weight profile still sums to 1", () => {
    for (const w of [CATEGORY_WEIGHTS, MARKET_PROFILE_WEIGHTS]) {
      expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    }
  });
});

describe("underdog edge measures line softness, not the market's lean", () => {
  const mk = (propType: string, line: number, underdogLine: number, direction: Direction): SerializedProp =>
    ({
      id: "x", date: "2026-09-13", sport: "NFL", league: "NFL", playerName: "p",
      team: "t", opponent: "o", gameStartTime: null, propType, line,
      underdogLine, marketLine: line,
      // The synthesised "projection" must no longer influence the edge.
      marketProjection: line + 6.3,
      direction, source: "The Odds API", projection: null, payoutMultiplier: null,
      injuryStatus: null, notes: null, status: "pending", actualResult: null, isDemo: false,
    }) as SerializedProp;

  it("is exactly zero when the pick'em line matches the market line", () => {
    for (const [pt, l] of [["Receptions", 4.5], ["Receiving Yards", 60.5], ["Passing Yards", 250.5]] as const) {
      expect(computeUnderdogEdge(mk(pt, l, l, "OVER"))).toBe(0);
      expect(computeUnderdogEdge(mk(pt, l, l, "UNDER"))).toBe(0);
    }
  });

  it("is positive when the pick'em line is softer, negative when tougher", () => {
    expect(computeUnderdogEdge(mk("Receptions", 4.5, 4.0, "OVER"))).toBe(0.5);
    expect(computeUnderdogEdge(mk("Receptions", 4.5, 5.0, "OVER"))).toBe(-0.5);
    expect(computeUnderdogEdge(mk("Receptions", 4.5, 5.0, "UNDER"))).toBe(0.5);
    expect(computeUnderdogEdge(mk("Receptions", 4.5, 4.0, "UNDER"))).toBe(-0.5);
  });

  it("does not scale with line magnitude", () => {
    expect(computeUnderdogEdge(mk("Passing Yards", 250.5, 250.5, "OVER"))).toBe(0);
    expect(computeUnderdogEdge(mk("Passing Yards", 250.5, 245.5, "OVER"))).toBe(5);
  });
});
