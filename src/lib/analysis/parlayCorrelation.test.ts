import { describe, expect, it } from "vitest";
import { analyzeParlay, makeGameKey, parlayPayout, type ParlayLegInput } from "./parlayCorrelation";

function leg(over: Partial<ParlayLegInput>): ParlayLegInput {
  return {
    pickId: Math.random().toString(),
    playerName: "Player",
    team: "A",
    opponent: "B",
    gameKey: makeGameKey("A", "B", "2026-06-30"),
    propType: "Points",
    direction: "OVER",
    confidenceScore: 70,
    riskLevel: "Medium",
    ...over,
  };
}

describe("parlayPayout", () => {
  it("computes payout and profit", () => {
    expect(parlayPayout(5, 10)).toEqual({ projectedPayout: 50, profitIfWon: 45, lossIfLost: -5 });
  });
});

describe("makeGameKey", () => {
  it("is order-independent", () => {
    expect(makeGameKey("A", "B", "2026-06-30")).toBe(makeGameKey("B", "A", "2026-06-30"));
  });
});

describe("analyzeParlay", () => {
  it("warns on same-player correlation", () => {
    const a = analyzeParlay([leg({ playerName: "Star", propType: "Points" }), leg({ playerName: "Star", propType: "Assists" })]);
    expect(a.correlationPairs.some((p) => p.level === "high")).toBe(true);
    expect(a.warnings.join(" ")).toMatch(/correlated/i);
  });

  it("computes combined hit estimate as a product of confidences", () => {
    const a = analyzeParlay([
      leg({ playerName: "P1", gameKey: "g1", confidenceScore: 80 }),
      leg({ playerName: "P2", gameKey: "g2", confidenceScore: 50 }),
    ]);
    expect(a.combinedHitEstimate).toBeCloseTo(0.4, 5);
  });

  it("rates 4+ leg parlays as high risk", () => {
    const legs = ["a", "b", "c", "d"].map((n, i) => leg({ playerName: n, gameKey: `g${i}` }));
    expect(analyzeParlay(legs).combinedRisk).toBe("High");
  });
});
