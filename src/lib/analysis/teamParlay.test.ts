import { describe, expect, it } from "vitest";
import {
  americanToDecimal,
  decimalToAmerican,
  teamParlayOdds,
  settleTeamParlay,
  analyzeTeamParlay,
  type TeamParlayLegInput,
} from "./teamParlay";

describe("team parlay odds math", () => {
  it("converts American to decimal odds", () => {
    expect(americanToDecimal(100)).toBeCloseTo(2, 6);
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 6);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 6);
  });

  it("round-trips decimal ↔ American", () => {
    expect(decimalToAmerican(2)).toBe(100);
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(1.5)).toBe(-200);
  });

  it("multiplies leg decimal odds for the combined payout", () => {
    // -200 (1.5) × +150 (2.5) = 3.75 → $5 stake returns $18.75, profit $13.75
    const o = teamParlayOdds([{ priceAmerican: -200 }, { priceAmerican: 150 }], 5);
    expect(o.combinedDecimal).toBeCloseTo(3.75, 4);
    expect(o.projectedPayout).toBeCloseTo(18.75, 2);
    expect(o.profitIfWon).toBeCloseTo(13.75, 2);
  });

  it("falls back to even money when a price is missing", () => {
    const o = teamParlayOdds([{ priceAmerican: null }, { priceAmerican: undefined }], 10);
    expect(o.combinedDecimal).toBeCloseTo(4, 4); // 2 × 2
    expect(o.projectedPayout).toBeCloseTo(40, 2);
  });
});

describe("team parlay settlement", () => {
  const legs = (statuses: ("win" | "loss" | "push" | "void" | "pending")[]) =>
    statuses.map((status, i) => ({ status, priceAmerican: i === 0 ? -200 : 150 }));

  it("is pending while any leg is undecided", () => {
    expect(settleTeamParlay(5, legs(["win", "pending"])).status).toBe("pending");
  });

  it("loses if any leg loses", () => {
    const r = settleTeamParlay(5, legs(["win", "loss"]));
    expect(r.status).toBe("lost");
    expect(r.profitLoss).toBe(-5);
  });

  it("pays the product of the winning legs' odds", () => {
    const r = settleTeamParlay(5, legs(["win", "win"]));
    expect(r.status).toBe("won");
    expect(r.payout).toBeCloseTo(18.75, 2); // 5 × 1.5 × 2.5
    expect(r.profitLoss).toBeCloseTo(13.75, 2);
  });

  it("removes a pushed leg and pays on the survivors", () => {
    // leg0 (-200 → 1.5) pushes, leg1 (+150 → 2.5) wins → pay 5 × 2.5 = 12.5
    const r = settleTeamParlay(5, legs(["push", "win"]));
    expect(r.status).toBe("won");
    expect(r.payout).toBeCloseTo(12.5, 2);
  });

  it("returns the stake when every leg voids", () => {
    const r = settleTeamParlay(5, legs(["void", "push"]));
    expect(r.status).toBe("void");
    expect(r.profitLoss).toBe(0);
    expect(r.payout).toBe(5);
  });
});

describe("team parlay analysis", () => {
  const leg = (over: Partial<TeamParlayLegInput>): TeamParlayLegInput => ({
    teamPickId: Math.random().toString(),
    recommendedTeam: "Team A",
    opponent: "Team Z",
    side: "HOME",
    league: "MLB",
    priceAmerican: -150,
    winProbability: 0.6,
    confidenceScore: 65,
    riskLevel: "Medium",
    ...over,
  });

  it("estimates combined win probability as the product of legs", () => {
    const a = analyzeTeamParlay([leg({ winProbability: 0.6 }), leg({ winProbability: 0.5 })]);
    expect(a.combinedHitEstimate).toBeCloseTo(0.3, 6);
    expect(a.legCount).toBe(2);
  });

  it("hard-warns when two legs are the same game (opposite sides)", () => {
    const a = analyzeTeamParlay([
      leg({ recommendedTeam: "Yankees", opponent: "Red Sox" }),
      leg({ recommendedTeam: "Red Sox", opponent: "Yankees" }),
    ]);
    expect(a.warnings.join(" ")).toMatch(/same game/i);
    expect(a.combinedRisk).toBe("High");
  });

  it("flags soccer draw risk", () => {
    const a = analyzeTeamParlay([leg({ league: "WorldCup", drawProbability: 0.31 }), leg({})]);
    expect(a.warnings.join(" ")).toMatch(/draw risk/i);
  });
});
