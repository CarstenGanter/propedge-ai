import { describe, expect, it } from "vitest";
import {
  breakEvenPerLeg,
  compareSlipSizes,
  entryMultiplier,
  jointHitProbability,
  pickBreakEven,
  pickValue,
  STANDARD_PICK_PAYOUT,
  marginalLegRequirement,
  slipEconomics,
} from "./pickemMath";

describe("breakEvenPerLeg", () => {
  it("matches the known standard-payout bars", () => {
    expect(breakEvenPerLeg(3, 2)! * 100).toBeCloseTo(57.7, 1);
    expect(breakEvenPerLeg(6, 3)! * 100).toBeCloseTo(55.0, 1);
    expect(breakEvenPerLeg(10, 4)! * 100).toBeCloseTo(56.2, 1);
    expect(breakEvenPerLeg(20, 5)! * 100).toBeCloseTo(54.9, 1);
  });

  it("tracks a discounted or boosted multiplier", () => {
    expect(breakEvenPerLeg(5.85, 3)! * 100).toBeCloseTo(55.5, 1); // a real observed payout
    expect(breakEvenPerLeg(7.2, 3)! * 100).toBeCloseTo(51.8, 1); // boosted
  });

  it("rejects nonsense", () => {
    expect(breakEvenPerLeg(0, 3)).toBeNull();
    expect(breakEvenPerLeg(-2, 3)).toBeNull();
    expect(breakEvenPerLeg(6, 0)).toBeNull();
    expect(breakEvenPerLeg(Number.NaN, 3)).toBeNull();
  });
});

describe("slipEconomics", () => {
  it("computes EV as multiplier × P(all) − 1", () => {
    const e = slipEconomics(6, [0.6, 0.6, 0.6]);
    expect(e.modelPAll).toBeCloseTo(0.216, 6);
    expect(e.ev).toBeCloseTo(0.296, 3);
    expect(e.verdict).toBe("positive");
  });

  it("is exactly break-even when every leg sits on the bar", () => {
    const be = breakEvenPerLeg(6, 3)!;
    const e = slipEconomics(6, [be, be, be]);
    expect(e.ev).toBeCloseTo(0, 9);
    expect(e.verdict).toBe("marginal");
    expect(e.cushion).toBeCloseTo(0, 9);
  });

  it("reports a negative verdict below the bar", () => {
    expect(slipEconomics(3, [0.54, 0.54]).verdict).toBe("negative");
    expect(slipEconomics(3, [0.54, 0.54]).ev).toBeLessThan(0);
  });

  it("exposes the cushion over break-even in per-leg terms", () => {
    const e = slipEconomics(6, [0.6, 0.6, 0.6]);
    expect(e.modelPerLeg).toBeCloseTo(0.6, 9);
    expect(e.cushion).toBeCloseTo(0.6 - breakEvenPerLeg(6, 3)!, 9);
  });

  it("handles unequal legs via the geometric mean", () => {
    const e = slipEconomics(6, [0.7, 0.5, 0.6]);
    expect(e.modelPAll).toBeCloseTo(0.21, 6);
    expect(e.modelPerLeg).toBeCloseTo(Math.pow(0.21, 1 / 3), 9);
  });

  it("flags that the probability is not calibrated unless told otherwise", () => {
    expect(slipEconomics(6, [0.6, 0.6]).pIsCalibrated).toBe(false);
    expect(slipEconomics(6, [0.6, 0.6], { pIsCalibrated: true }).pIsCalibrated).toBe(true);
  });

  it("marks an implausible per-leg edge as overconfident", () => {
    // 66% per leg is what the current uncalibrated confidence produces; prop
    // markets do not hand out edges that size.
    expect(slipEconomics(6, [0.66, 0.66, 0.66]).overconfident).toBe(true);
    expect(slipEconomics(6, [0.58, 0.58, 0.58]).overconfident).toBe(false);
  });

  it("stops flagging overconfidence once the probability is calibrated", () => {
    expect(slipEconomics(6, [0.66, 0.66], { pIsCalibrated: true }).overconfident).toBe(false);
  });

  it("degrades safely on a zero or missing multiplier", () => {
    const e = slipEconomics(0, [0.6, 0.6]);
    expect(e.ev).toBe(-1);
    expect(e.breakEvenPerLeg).toBeNull();
    expect(e.verdict).toBe("negative");
  });
});

describe("marginalLegRequirement", () => {
  it("shows the fourth leg is the expensive one at standard payouts", () => {
    expect(marginalLegRequirement(3, 6)).toBeCloseTo(0.5, 6); // 2 → 3
    expect(marginalLegRequirement(6, 10)).toBeCloseTo(0.6, 6); // 3 → 4
    expect(marginalLegRequirement(10, 20)).toBeCloseTo(0.5, 6); // 4 → 5
  });

  it("moves with a boosted ladder", () => {
    expect(marginalLegRequirement(6, 12)).toBeCloseTo(0.5, 6);
  });
});

describe("compareSlipSizes", () => {
  const STANDARD = { 2: 3, 3: 6, 4: 10, 5: 20 };

  it("computes the per-leg bar for each size", () => {
    const rows = compareSlipSizes(STANDARD);
    expect(rows.map((r) => r.size)).toEqual([2, 3, 4, 5]);
    expect(rows[0].breakEvenPerLeg).toBeCloseTo(0.5774, 4); // 3^(-1/2)
    expect(rows[1].breakEvenPerLeg).toBeCloseTo(0.5503, 4); // 6^(-1/3)
    expect(rows[2].breakEvenPerLeg).toBeCloseTo(0.5623, 4); // 10^(-1/4)
    expect(rows[3].breakEvenPerLeg).toBeCloseTo(0.5493, 4); // 20^(-1/5)
  });

  it("flags the 4-leg tier as dominated — the bar does not fall monotonically", () => {
    const rows = compareSlipSizes(STANDARD);
    const four = rows.find((r) => r.size === 4)!;
    // 5-leg has the lowest bar of all, so it is what dominates the 4-leg tier.
    expect(four.dominatedBy).toBe(5);
    // The 2-leg tier is the most expensive of all and is dominated too.
    expect(rows.find((r) => r.size === 2)!.dominatedBy).toBe(5);
    // Nothing dominates the cheapest size.
    expect(rows.find((r) => r.size === 5)!.dominatedBy).toBeNull();
  });

  it("re-ranks when the multipliers change rather than hardcoding a rule", () => {
    // If the 4-leg tier paid 16x it would beat every other size.
    const rows = compareSlipSizes({ 2: 3, 3: 6, 4: 16, 5: 20 });
    expect(rows.find((r) => r.size === 4)!.dominatedBy).toBeNull();
    expect(rows.find((r) => r.size === 3)!.dominatedBy).toBe(4);
  });

  it("ignores unusable multipliers", () => {
    expect(compareSlipSizes({ 1: 2, 2: 0, 3: 6 }).map((r) => r.size)).toEqual([3]);
  });
});

describe("jointHitProbability", () => {
  it("equals the independent product when nothing is correlated", () => {
    expect(jointHitProbability([0.6, 0.55, 0.5])).toBeCloseTo(0.6 * 0.55 * 0.5, 10);
    expect(jointHitProbability([0.6, 0.55], [{ i: 0, j: 1, rho: 0 }])).toBeCloseTo(0.33, 10);
  });

  it("raises P(all hit) when legs are positively correlated", () => {
    const independent = 0.56 * 0.56;
    const correlated = jointHitProbability([0.56, 0.56], [{ i: 0, j: 1, rho: 0.3 }]);
    expect(correlated).toBeGreaterThan(independent);
    // Worked example from the research: two 56% legs at rho=0.3 clear the 3x
    // break-even (1/3) that the same legs miss when treated as independent.
    expect(independent).toBeLessThan(1 / 3);
    expect(correlated).toBeGreaterThan(1 / 3);
  });

  it("is monotonic in rho and lowers P(all) when negatively correlated", () => {
    const at = (rho: number) => jointHitProbability([0.55, 0.6], [{ i: 0, j: 1, rho }]);
    expect(at(-0.3)).toBeLessThan(at(0));
    expect(at(0)).toBeLessThan(at(0.3));
    expect(at(0.3)).toBeLessThan(at(0.6));
  });

  it("stays a probability at the extremes", () => {
    expect(jointHitProbability([0.99, 0.99], [{ i: 0, j: 1, rho: 0.95 }])).toBeLessThanOrEqual(1);
    expect(jointHitProbability([0.01, 0.01], [{ i: 0, j: 1, rho: 0.95 }])).toBeGreaterThanOrEqual(0);
  });
});

describe("slipEconomics with correlated legs", () => {
  it("separates the structural uplift from an implausible per-leg claim", () => {
    const pairs = [{ i: 0, j: 1, rho: 0.3 }];
    const econ = slipEconomics(3, [0.56, 0.56], { correlatedPairs: pairs });
    expect(econ.correlationUplift).toBeGreaterThan(0);
    // The average leg is unchanged; only the joint probability moves.
    expect(econ.rawPerLeg).toBeCloseTo(0.56, 6);
    expect(econ.modelPerLeg!).toBeGreaterThan(econ.rawPerLeg!);
    // Correlation flips the verdict without either leg improving.
    expect(slipEconomics(3, [0.56, 0.56]).verdict).toBe("negative");
    expect(econ.verdict).toBe("positive");
  });

  it("does not let correlation trip the overconfidence guard", () => {
    // Legs are individually plausible; the uplift must not read as overconfidence.
    const econ = slipEconomics(6, [0.6, 0.6, 0.6], { correlatedPairs: [{ i: 0, j: 1, rho: 0.3 }] });
    expect(econ.overconfident).toBe(false);
    // A genuinely implausible per-leg claim still trips it.
    expect(slipEconomics(6, [0.7, 0.7, 0.7]).overconfident).toBe(true);
  });
});

describe("per-pick payouts", () => {
  it("prices an entry as the product of each pick's payout", () => {
    // The user's real 2026-09-27 SNF slip: shown as 5.61x after a small same-game trim.
    expect(entryMultiplier([1.71, 1.78, 1.87])).toBeCloseTo(5.692, 3);
    // Three standard picks: shown as 6.5x.
    expect(entryMultiplier([null, null, null])).toBeCloseTo(6.54, 2);
  });

  it("treats missing or nonsense payouts as a standard pick", () => {
    expect(entryMultiplier([null, undefined, 0, -1, Number.NaN])).toBeCloseTo(STANDARD_PICK_PAYOUT ** 5, 6);
  });

  it("sets each pick's bar at one over its payout", () => {
    expect(pickBreakEven(1.71)).toBeCloseTo(0.5848, 4);
    expect(pickBreakEven(1.55)).toBeCloseTo(0.6452, 4); // the Kyren Williams leg that was swapped out
    expect(pickBreakEven(null)).toBeCloseTo(0.5348, 4);
  });

  it("scores a pick by probability times payout, so a likely favourite can still lose value", () => {
    expect(pickValue(0.62, 1.71)).toBeGreaterThan(1); // +EV
    expect(pickValue(0.55, 1.55)).toBeLessThan(1); // likely, but priced too short
  });
});
