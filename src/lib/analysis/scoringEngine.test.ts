import { describe, expect, it } from "vitest";
import { analyzeProp } from "./scoringEngine";
import { CATEGORY_WEIGHTS, type ResearchBundle, type ScorablePropInput } from "@/types";

const baseProp: ScorablePropInput = {
  sport: "NBA",
  league: "NBA",
  playerName: "Test Player",
  team: "A",
  opponent: "B",
  propType: "Points",
  line: 25.5,
  direction: "OVER",
};

const strongOverBundle: ResearchBundle = {
  playerStats: {
    recentGames: [30, 28, 27, 31, 26, 29, 33, 24, 28, 30],
    seasonAverage: 28.5,
    seasonStdDev: 3,
    gamesPlayed: 40,
    usage: 70,
    usageTrend: "up",
    source: "test",
  },
  matchup: { opponentDefenseRank: 27, leagueSize: 30, opponentAllowedAverage: 28, pace: "fast", source: "test" },
  news: { playerStatus: "active", lineupConfirmed: true, teammateAbsencesBoost: true, source: "test" },
  market: { projection: 28, comparableLines: [26.5, 27], source: "test" },
  sentiment: { score: 0.6, credibleSourceCount: 3, source: "test" },
  historical: { vsOpponentAverage: 29, source: "test" },
};

describe("scoring engine", () => {
  it("category weights sum to 1", () => {
    const sum = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("is deterministic for the same input", () => {
    const a = analyzeProp(baseProp, strongOverBundle);
    const b = analyzeProp(baseProp, strongOverBundle);
    expect(a.confidenceScore).toBe(b.confidenceScore);
    expect(a.edgeScore).toBe(b.edgeScore);
  });

  it("scores a well-supported OVER above neutral", () => {
    const a = analyzeProp(baseProp, strongOverBundle);
    expect(a.confidenceScore).toBeGreaterThan(60);
    expect(a.edgeScore).toBeGreaterThan(0);
    expect(a.dataCompleteness).toBe(1);
    expect(a.reasonsFor.length).toBeGreaterThan(0);
  });

  it("records warnings and stays near neutral when data is missing", () => {
    const a = analyzeProp(baseProp, {});
    expect(a.warnings.length).toBeGreaterThan(0);
    expect(a.dataCompleteness).toBeLessThan(0.3);
    expect(a.confidenceScore).toBeGreaterThan(35);
    expect(a.confidenceScore).toBeLessThan(65);
  });

  it("flags a player ruled OUT with a warning", () => {
    const a = analyzeProp(
      { ...baseProp, injuryStatus: "OUT" },
      { ...strongOverBundle, news: { playerStatus: "out", source: "test" } },
    );
    expect(a.warnings.join(" ")).toMatch(/OUT/i);
  });

  it("never fabricates a source label", () => {
    const a = analyzeProp(baseProp, strongOverBundle);
    for (const e of a.evidence) expect(e.sourceName.length).toBeGreaterThan(0);
  });
});
