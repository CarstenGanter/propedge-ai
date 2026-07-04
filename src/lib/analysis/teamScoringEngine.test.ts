import { describe, expect, it } from "vitest";
import { analyzeGame } from "./teamScoringEngine";
import { TEAM_CATEGORY_WEIGHTS, type GameInput } from "@/types";

const baseGame: GameInput = {
  league: "MLB",
  homeTeam: "Yankees",
  awayTeam: "Twins",
  threeWay: false,
  market: {
    homeTeam: "Yankees",
    awayTeam: "Twins",
    homePrice: -200,
    awayPrice: 170,
    homeProb: 0.66,
    awayProb: 0.34,
    drawProb: 0,
    bookCount: 5,
    source: "The Odds API",
  },
  form: { homeRecord: "50-30", awayRecord: "40-40", source: "ESPN" },
};

describe("team scoring engine", () => {
  it("team category weights sum to 1", () => {
    const sum = Object.values(TEAM_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("is deterministic", () => {
    const a = analyzeGame(baseGame);
    const b = analyzeGame(baseGame);
    expect(a.confidenceScore).toBe(b.confidenceScore);
    expect(a.recommendedTeam).toBe(b.recommendedTeam);
  });

  it("recommends the market favorite with stronger form", () => {
    const a = analyzeGame(baseGame);
    expect(a.recommendedSide).toBe("HOME");
    expect(a.recommendedTeam).toBe("Yankees");
    expect(a.confidenceScore).toBeGreaterThan(60);
    expect(a.priceAmerican).toBe(-200);
  });

  it("flags positive value when the model beats the market", () => {
    // Underdog by market, but far superior form → model above market = value.
    const g: GameInput = {
      ...baseGame,
      market: { ...baseGame.market!, homeProb: 0.48, awayProb: 0.52 },
      form: { homeRecord: "60-20", awayRecord: "30-50", source: "ESPN" },
    };
    const a = analyzeGame(g);
    expect(a.valueEdge).toBeGreaterThan(0);
    expect(a.tags).toContain("value");
  });

  it("warns and stays cautious with no market data", () => {
    const a = analyzeGame({ league: "MLB", homeTeam: "A", awayTeam: "B", threeWay: false });
    expect(a.warnings.join(" ")).toMatch(/market/i);
    expect(a.dataCompleteness).toBeLessThan(0.6);
  });

  it("flags high draw risk for 3-way games", () => {
    const a = analyzeGame({
      league: "EPL",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      threeWay: true,
      market: {
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        homeProb: 0.4,
        awayProb: 0.28,
        drawProb: 0.32,
        bookCount: 4,
        source: "The Odds API",
      },
    });
    expect(a.warnings.join(" ")).toMatch(/draw risk/i);
    expect(a.drawProbability).toBeGreaterThan(0.28);
  });

  // ---- richer form + injuries (team-v1.1) ----

  const evenMarket: GameInput = {
    league: "MLB",
    homeTeam: "Home",
    awayTeam: "Away",
    threeWay: false,
    market: {
      homeTeam: "Home",
      awayTeam: "Away",
      homePrice: -110,
      awayPrice: -110,
      homeProb: 0.5,
      awayProb: 0.5,
      drawProb: 0,
      bookCount: 5,
      source: "The Odds API",
    },
    form: { homeRecord: "45-45", awayRecord: "45-45", homeWinPct: 0.5, awayWinPct: 0.5, source: "MLB Stats API" },
  };

  it("hot last-10 and better run differential lift the home side over a coin-flip market", () => {
    const g: GameInput = {
      ...evenMarket,
      form: {
        ...evenMarket.form!,
        homeLast10Pct: 0.8,
        awayLast10Pct: 0.3,
        homeLast10Record: "8-2",
        awayLast10Record: "3-7",
        homeRunDiff: 90,
        awayRunDiff: -40,
      },
    };
    const a = analyzeGame(g);
    expect(a.recommendedSide).toBe("HOME");
    expect(a.winProbability).toBeGreaterThan(0.5);
    expect(a.scoreBreakdown.form).toBeGreaterThan(50);
    // Evidence cites the concrete recent-form signals.
    expect(a.evidence.some((e) => /last 10/i.test(e.title))).toBe(true);
    expect(a.evidence.some((e) => /run differential/i.test(e.title))).toBe(true);
  });

  it("caps the total form swing so it never overwhelms the market", () => {
    const g: GameInput = {
      ...evenMarket,
      form: {
        homeRecord: "80-10",
        awayRecord: "10-80",
        homeWinPct: 0.89,
        awayWinPct: 0.11,
        homeLast10Pct: 1,
        awayLast10Pct: 0,
        homeRunDiff: 300,
        awayRunDiff: -300,
        source: "MLB Stats API",
      },
    };
    const a = analyzeGame(g);
    // Market is 0.5; the ±0.10 cap means the model can't exceed ~0.60.
    expect(a.winProbability).toBeLessThanOrEqual(0.61);
  });

  it("activates the injuries category and surfaces named players when data is present", () => {
    const g: GameInput = {
      ...evenMarket,
      injuries: {
        homeKeyOut: 0,
        awayKeyOut: 3,
        notes: [{ summary: "Away: Star Player (SS) — 10-day IL", sourceName: "ESPN" }],
        source: "ESPN",
      },
    };
    const a = analyzeGame(g);
    expect(a.recommendedSide).toBe("HOME");
    expect(a.scoreBreakdown.injuries).toBeGreaterThan(50);
    expect(a.warnings.join(" ")).not.toMatch(/injury data not available/i);
    expect(a.evidence.some((e) => /Star Player/.test(e.summary))).toBe(true);
  });

  it("uses probable-pitcher ERA edge as a tiebreaker", () => {
    const g: GameInput = {
      ...evenMarket,
      pitchers: {
        home: { name: "Ace McGee", era: 2.1, whip: 0.95 },
        away: { name: "Journeyman Jones", era: 5.4, whip: 1.5 },
      },
    };
    const a = analyzeGame(g);
    expect(a.recommendedSide).toBe("HOME");
    expect(a.evidence.some((e) => /Ace McGee/.test(e.summary))).toBe(true);
  });

  it("still warns when rich data is absent", () => {
    const a = analyzeGame({
      league: "MLB",
      homeTeam: "A",
      awayTeam: "B",
      threeWay: false,
      market: {
        homeTeam: "A",
        awayTeam: "B",
        homeProb: 0.55,
        awayProb: 0.45,
        drawProb: 0,
        bookCount: 3,
        source: "The Odds API",
      },
    });
    expect(a.warnings.join(" ")).toMatch(/injury data not available/i);
    expect(a.warnings.join(" ")).toMatch(/no team form/i);
  });
});
