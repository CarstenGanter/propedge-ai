import { describe, expect, it } from "vitest";
import { breakEvenPerLeg, marginalLegRequirement, slipEconomics } from "./pickemMath";

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
