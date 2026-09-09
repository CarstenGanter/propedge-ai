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

  it("carries provider source URLs and sample notes into evidence", () => {
    const a = analyzeProp(baseProp, {
      ...strongOverBundle,
      playerStats: { ...strongOverBundle.playerStats!, sourceUrl: "https://espn.example/gamelog", note: "Includes 2025 games." },
      matchup: { ...strongOverBundle.matchup!, sourceUrl: "https://espn.example/team" },
      historical: { homeAway: "away", weatherNote: "Open-Meteo forecast at kickoff: 48°F, wind 18 mph.", weatherConcern: true, source: "Open-Meteo", sourceUrl: "https://open-meteo.example" },
    });
    const form = a.evidence.find((e) => e.category === "recentForm")!;
    expect(form.sourceUrl).toBe("https://espn.example/gamelog");
    expect(form.summary).toContain("Includes 2025 games.");
    expect(a.evidence.find((e) => e.category === "matchup")?.sourceUrl).toBe("https://espn.example/team");
    const hist = a.evidence.find((e) => e.category === "historicalSplits")!;
    expect(hist.sourceUrl).toBe("https://open-meteo.example");
    expect(hist.summary).toContain("wind 18 mph");
    expect(a.warnings.join(" ")).toMatch(/Weather flagged/);
  });

  it("weights NFL recent form down until 4 current-season games exist", () => {
    const nflProp: ScorablePropInput = { ...baseProp, sport: "NFL", league: "NFL", propType: "Receiving Yards", line: 60.5 };
    const hotForm = { recentGames: [90, 85, 88, 92, 80, 95, 84, 91, 87, 89], seasonAverage: 88, seasonStdDev: 5, gamesPlayed: 10, source: "ESPN gamelog" };
    const full = analyzeProp(nflProp, { playerStats: { ...hotForm, currentSeasonGames: 6 } });
    const early = analyzeProp(nflProp, { playerStats: { ...hotForm, currentSeasonGames: 1 } });
    expect(full.scoreBreakdown.recentForm).toBeGreaterThan(early.scoreBreakdown.recentForm);
    expect(early.scoreBreakdown.recentForm).toBeGreaterThan(50);
    expect(early.warnings.join(" ")).toMatch(/Only 1 game played this NFL season/);
    expect(full.warnings.join(" ")).not.toMatch(/NFL season/);
    // Zero games gets its own wording, and is shrunk hardest.
    const none = analyzeProp(nflProp, { playerStats: { ...hotForm, currentSeasonGames: 0 } });
    expect(none.warnings.join(" ")).toMatch(/No games played yet this NFL season/);
    expect(none.scoreBreakdown.recentForm).toBeLessThan(early.scoreBreakdown.recentForm);
    // The gate is NFL-specific.
    const nba = analyzeProp(baseProp, { playerStats: { ...hotForm, currentSeasonGames: 1 } });
    expect(nba.warnings.join(" ")).not.toMatch(/NFL season/);
  });
});
