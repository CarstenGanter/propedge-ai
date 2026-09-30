import { describe, expect, it } from "vitest";
import { binaryLogLoss, crps, intervalLogScore, medianOfCdf } from "./forecastScores";
import { normalCdf } from "./distributions";

describe("forecast scores", () => {
  it("matches the closed-form CRPS of a normal", () => {
    // CRPS(N(0,1), y) = y(2Φ(y) − 1) + 2φ(y) − 1/√π
    const exact = (y: number) =>
      y * (2 * normalCdf(y) - 1) + 2 * Math.exp(-(y * y) / 2) / Math.sqrt(2 * Math.PI) - 1 / Math.sqrt(Math.PI);
    for (const y of [-1.3, 0, 0.7, 2]) expect(crps(normalCdf, y, -10, 10, 4000)).toBeCloseTo(exact(y), 4);
  });

  it("rewards a forecast centred on the outcome", () => {
    const at = (m: number) => (x: number) => normalCdf(x - m);
    expect(crps(at(0), 0, -10, 10)).toBeLessThan(crps(at(2), 0, -10, 10));
    expect(intervalLogScore(at(0), 0)).toBeLessThan(intervalLogScore(at(2), 0));
  });

  it("scores binary calls and finds medians", () => {
    expect(binaryLogLoss(0.9, true)).toBeLessThan(binaryLogLoss(0.6, true));
    expect(medianOfCdf((x) => normalCdf(x - 3), -10, 10)).toBeCloseTo(3, 6);
  });
});
