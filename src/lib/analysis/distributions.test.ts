import { describe, expect, it } from "vitest";
import {
  bivariateNormalCdf,
  negBinomialCdf,
  normalCdf,
  normalQuantile,
  poissonCdf,
  studentTCdf,
} from "./distributions";

describe("normalCdf", () => {
  it("matches published values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 4);
    expect(normalCdf(2.5758)).toBeCloseTo(0.995, 3);
  });
  it("is symmetric", () => {
    for (const z of [0.25, 0.5, 1.1, 2.3]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 5);
    }
  });
});

describe("normalQuantile", () => {
  it("inverts the CDF", () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95, 0.99]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 4);
    }
  });
  it("matches published critical values", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
  });
});

describe("studentTCdf", () => {
  it("matches published t critical values", () => {
    // t(0.975, df=10) = 2.228; t(0.95, df=5) = 2.015
    expect(studentTCdf(2.228, 10)).toBeCloseTo(0.975, 3);
    expect(studentTCdf(2.015, 5)).toBeCloseTo(0.95, 3);
    expect(studentTCdf(0, 7)).toBeCloseTo(0.5, 6);
  });
  it("has fatter tails than the normal at low df", () => {
    expect(studentTCdf(2, 3)).toBeLessThan(normalCdf(2));
  });
  it("converges to the normal as df grows", () => {
    expect(studentTCdf(1.5, 1000)).toBeCloseTo(normalCdf(1.5), 4);
  });
  it("is symmetric", () => {
    expect(studentTCdf(1.3, 8) + studentTCdf(-1.3, 8)).toBeCloseTo(1, 5);
  });
});

describe("poissonCdf", () => {
  it("matches hand-computed values", () => {
    expect(poissonCdf(0, 1)).toBeCloseTo(Math.exp(-1), 6);
    // Poisson(5): P(X<=4) = 0.440493
    expect(poissonCdf(4, 5)).toBeCloseTo(0.440493, 5);
    // The classic prop case: mean 5 receptions, line 4.5 -> P(over) = 1 - P(<=4)
    expect(1 - poissonCdf(4, 5)).toBeCloseTo(0.5595, 3);
  });
  it("is bounded and monotone", () => {
    expect(poissonCdf(-1, 3)).toBe(0);
    expect(poissonCdf(100, 3)).toBeCloseTo(1, 6);
    expect(poissonCdf(2, 3)).toBeLessThan(poissonCdf(3, 3));
  });
});

describe("negBinomialCdf", () => {
  it("reduces to Poisson when the data are not overdispersed", () => {
    // Under-dispersed (variance < mean) is common for receptions.
    expect(negBinomialCdf(4, 5, 4)).toBeCloseTo(poissonCdf(4, 5), 9);
    expect(negBinomialCdf(4, 5, 5)).toBeCloseTo(poissonCdf(4, 5), 9);
  });

  it("spreads mass wider than Poisson when overdispersed", () => {
    // Same mean, more variance -> more probability in both tails.
    const nb = 1 - negBinomialCdf(7, 5, 12);
    const po = 1 - poissonCdf(7, 5);
    expect(nb).toBeGreaterThan(po);
  });

  it("never returns a negative dispersion or NaN", () => {
    for (const [mean, v] of [[5, 4], [5, 5.0001], [0.5, 2], [12, 40]] as const) {
      const p = negBinomialCdf(3, mean, v);
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("handles a zero mean without dividing by zero", () => {
    expect(negBinomialCdf(0, 0, 0)).toBe(1);
  });
});

describe("bivariateNormalCdf", () => {
  // Phi2(0,0,rho) has the closed form 1/4 + arcsin(rho)/(2*pi).
  const exact = (r: number) => 0.25 + Math.asin(r) / (2 * Math.PI);

  it("matches the closed form at the origin across rho", () => {
    for (const r of [-0.8, -0.5, -0.2, 0, 0.2, 0.3, 0.5, 0.8, 0.95]) {
      expect(bivariateNormalCdf(0, 0, r)).toBeCloseTo(exact(r), 8);
    }
  });

  it("factorises into the marginals when rho is zero", () => {
    for (const [h, k] of [[0.5, 1], [-1, 2], [1.5, -0.5]]) {
      expect(bivariateNormalCdf(h, k, 0)).toBeCloseTo(normalCdf(h) * normalCdf(k), 12);
    }
  });

  it("reduces to a single marginal when the other bound is far out", () => {
    expect(bivariateNormalCdf(0.7, 8, 0.4)).toBeCloseTo(normalCdf(0.7), 10);
    expect(bivariateNormalCdf(-8, 0.3, 0.4)).toBeCloseTo(0, 10);
  });

  it("is symmetric in its arguments and clamps |rho| >= 1", () => {
    expect(bivariateNormalCdf(0.4, -1.1, 0.25)).toBeCloseTo(bivariateNormalCdf(-1.1, 0.4, 0.25), 12);
    expect(bivariateNormalCdf(0.3, 0.3, 1)).toBeLessThanOrEqual(1);
    expect(bivariateNormalCdf(0.3, 0.3, -1)).toBeGreaterThanOrEqual(0);
  });
});
