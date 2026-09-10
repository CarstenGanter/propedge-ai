import { describe, expect, it } from "vitest";
import { gameEnvironmentFavor, NEUTRAL_TOTAL } from "./gameEnvironment";

describe("gameEnvironmentFavor", () => {
  it("returns null when neither total nor spread is known", () => {
    expect(gameEnvironmentFavor({ propType: "Receiving Yards", direction: "OVER" })).toBeNull();
  });

  it("favors Overs in high-scoring games and Unders in low-scoring ones", () => {
    const hi = gameEnvironmentFavor({ propType: "Receiving Yards", direction: "OVER", gameTotal: 54.5 })!;
    const lo = gameEnvironmentFavor({ propType: "Receiving Yards", direction: "OVER", gameTotal: 34.5 })!;
    expect(hi.favor).toBeGreaterThan(0.9);
    expect(lo.favor).toBeLessThan(-0.9);
    expect(hi.note).toContain("high-scoring");
    expect(lo.note).toContain("low-scoring");

    const underLo = gameEnvironmentFavor({ propType: "Receiving Yards", direction: "UNDER", gameTotal: 34.5 })!;
    expect(underLo.favor).toBeGreaterThan(0.9); // a low total helps an Under
  });

  it("is neutral at a league-average total", () => {
    const e = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", gameTotal: NEUTRAL_TOTAL })!;
    expect(e.favor).toBe(0);
    expect(e.note).toContain("average");
  });

  it("lifts passing props for underdogs and rushing props for favorites", () => {
    const dogPass = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", teamSpread: 7 })!;
    const favPass = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", teamSpread: -7 })!;
    expect(dogPass.favor).toBeGreaterThan(0);
    expect(favPass.favor).toBeLessThan(0);
    expect(dogPass.note).toContain("underdog");

    const favRush = gameEnvironmentFavor({ propType: "Rushing Yards", direction: "OVER", teamSpread: -7 })!;
    const dogRush = gameEnvironmentFavor({ propType: "Rushing Yards", direction: "OVER", teamSpread: 7 })!;
    expect(favRush.favor).toBeGreaterThan(0);
    expect(dogRush.favor).toBeLessThan(0);
    expect(favRush.note).toContain("clock-killing");
  });

  it("treats receptions like the passing game", () => {
    const e = gameEnvironmentFavor({ propType: "Receptions", direction: "OVER", teamSpread: 7 })!;
    expect(e.favor).toBeGreaterThan(0);
  });

  it("treats combined rush+rec yardage as script-neutral", () => {
    const e = gameEnvironmentFavor({ propType: "Rush+Rec Yards", direction: "OVER", teamSpread: -9 })!;
    expect(e.favor).toBe(0);
    expect(e.note).toContain("script-neutral");
  });

  it("blends total and script, and renormalizes when only one is known", () => {
    const both = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", gameTotal: 54.5, teamSpread: 10 })!;
    expect(both.favor).toBeCloseTo(1, 3); // both maxed in the same direction
    const opposed = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", gameTotal: 54.5, teamSpread: -10 })!;
    expect(opposed.favor).toBeCloseTo(0.2, 3); // 0.6*1 + 0.4*(-1) = 0.2
    const totalOnly = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", gameTotal: 54.5 })!;
    expect(totalOnly.favor).toBeCloseTo(1, 3); // not muted by the missing spread
  });

  it("flags blowout risk at a double-digit spread, either side", () => {
    expect(gameEnvironmentFavor({ propType: "Receptions", direction: "OVER", teamSpread: 10 })!.blowoutRisk).toBe(true);
    expect(gameEnvironmentFavor({ propType: "Receptions", direction: "OVER", teamSpread: -13 })!.blowoutRisk).toBe(true);
    expect(gameEnvironmentFavor({ propType: "Receptions", direction: "OVER", teamSpread: -6 })!.blowoutRisk).toBe(false);
  });

  it("keeps favor inside -1..1", () => {
    for (const total of [0, 20, 44.5, 60, 90]) {
      for (const spread of [-30, -10, 0, 10, 30]) {
        const e = gameEnvironmentFavor({ propType: "Passing Yards", direction: "OVER", gameTotal: total, teamSpread: spread })!;
        expect(e.favor).toBeGreaterThanOrEqual(-1);
        expect(e.favor).toBeLessThanOrEqual(1);
      }
    }
  });
});
