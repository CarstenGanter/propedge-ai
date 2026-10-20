import { describe, expect, it } from "vitest";
import {
  bucketedEdge,
  clusterBootstrap,
  edgeSourceFor,
  excessPts,
  fitLogistic,
  leanSide,
  logit,
  mulberry32,
  overGap,
  overGapPts,
  roiWithPayouts,
  skillReport,
  skillScore,
  stackingFit,
  type SkillItem,
} from "./marketSkill";

const item = (pModel: number, pMarket: number, over: boolean, cluster = "g1", propType = "Receptions"): SkillItem => ({
  pModel,
  pMarket,
  over,
  cluster,
  propType,
});

describe("skillScore", () => {
  it("is zero when the model is the market", () => {
    const s = skillScore([item(0.55, 0.55, true), item(0.48, 0.48, false)])!;
    expect(s.skill).toBeCloseTo(0, 12);
    expect(s.llModel).toBeCloseTo(s.llMarket, 12);
  });

  it("matches a hand computation", () => {
    // Model 0.6 vs market 0.5 on one Over that hit: LL_model = −ln 0.6, LL_market = −ln 0.5.
    const s = skillScore([item(0.6, 0.5, true)])!;
    expect(s.llModel).toBeCloseTo(-Math.log(0.6), 12);
    expect(s.llMarket).toBeCloseTo(-Math.log(0.5), 12);
    expect(s.skill).toBeCloseTo(1 - Math.log(0.6) / Math.log(0.5), 12);
  });

  it("is negative when the model leans the wrong way", () => {
    expect(skillScore([item(0.65, 0.5, false), item(0.35, 0.5, true)])!.skill).toBeLessThan(0);
  });

  it("counts games, not props", () => {
    const s = skillScore([item(0.5, 0.5, true, "a"), item(0.5, 0.5, true, "a"), item(0.5, 0.5, true, "b")])!;
    expect(s.n).toBe(3);
    expect(s.games).toBe(2);
  });
});

describe("clusterBootstrap", () => {
  const items = Array.from({ length: 40 }, (_, i) => item(0.55, 0.5, i % 3 !== 0, `g${i % 10}`));

  it("is deterministic for a seed", () => {
    const stat = (s: SkillItem[]) => skillScore(s)?.skill ?? null;
    expect(clusterBootstrap(items, stat, { seed: 7, reps: 300 })).toEqual(clusterBootstrap(items, stat, { seed: 7, reps: 300 }));
  });

  it("brackets the point estimate", () => {
    const iv = clusterBootstrap(items, (s) => skillScore(s)?.skill ?? null, { reps: 500 })!;
    const point = skillScore(items)!.skill;
    expect(iv.lo).toBeLessThanOrEqual(point);
    expect(iv.hi).toBeGreaterThanOrEqual(point);
  });

  it("needs at least two games to resample", () => {
    expect(clusterBootstrap([item(0.5, 0.5, true, "only")], (s) => s.length)).toBeNull();
  });
});

describe("edge buckets and excess hits", () => {
  it("leans to the side the model rates above the market", () => {
    expect(leanSide({ pModel: 0.56, pMarket: 0.52 })).toBe("OVER");
    expect(leanSide({ pModel: 0.47, pMarket: 0.52 })).toBe("UNDER");
    expect(leanSide({ pModel: 0.5, pMarket: 0.5 })).toBeNull();
  });

  it("measures hits on the leaned side against what the market expected there", () => {
    // Leans Under twice (market Under = 0.45 each); one Under hits: (1 − 0.45 + 0 − 0.45) / 2 = 0.05.
    expect(excessPts([item(0.5, 0.55, false), item(0.5, 0.55, true)])).toBeCloseTo(5, 10);
  });

  it("bins by claimed edge in points", () => {
    const b = bucketedEdge([item(0.505, 0.5, true, "a"), item(0.53, 0.5, false, "b"), item(0.6, 0.5, true, "c")], [0, 1, 2, 4, 8], { reps: 50 });
    expect(b.map((x) => x.label)).toEqual(["0–1", "2–4", "8+"]);
    expect(b[2].meanClaimedPts).toBeCloseTo(10, 10);
  });
});

describe("skillReport", () => {
  it("splits by prop type, lean and edge source", () => {
    const xs = [item(0.6, 0.5, true, "a", "Receptions"), item(0.4, 0.5, false, "b", "Rushing Yards"), item(0.5, 0.5, true, "c", "Receptions")];
    const r = skillReport(xs, { reps: 50 });
    expect(r.overall!.n).toBe(3);
    expect(r.byPropType.map((g) => g.key).sort()).toEqual(["Receptions", "Rushing Yards"]);
    expect(r.byLean.map((g) => g.key).sort()).toEqual(["OVER", "UNDER", "agrees"]);
    expect(r.byEdgeSource.map((g) => g.key)).toEqual(["unknown"]);
  });
});

describe("roiWithPayouts", () => {
  it("pays (payout − 1) on a win and −1 on a loss", () => {
    expect(roiWithPayouts([{ payout: 1.8, won: true }, { payout: 1.5, won: false }])).toEqual({ n: 2, roi: (0.8 - 1) / 2 });
  });

  it("ignores payouts that cannot be per-pick payouts", () => {
    expect(roiWithPayouts([{ payout: 0.79, won: true }])).toBeNull();
  });
});

describe("edgeSourceFor", () => {
  const base = { previous: null, playerStatus: null, teammateOut: false };

  it("calls a soft or tough venue line a venue edge", () => {
    expect(edgeSourceFor({ ...base, venueFlag: "soft" })).toBe("venue");
    expect(edgeSourceFor({ ...base, venueFlag: "tough" })).toBe("venue");
  });

  it("calls a status change since the last forecast news", () => {
    expect(
      edgeSourceFor({ venueFlag: "none", previous: { playerStatus: null, teammateOut: false }, playerStatus: "questionable", teammateOut: false }),
    ).toBe("news");
    expect(
      edgeSourceFor({ venueFlag: null, previous: { playerStatus: "active", teammateOut: false }, playerStatus: "active", teammateOut: true }),
    ).toBe("news");
  });

  it("is model otherwise, including the first forecast of a prop", () => {
    expect(edgeSourceFor({ ...base, venueFlag: "none" })).toBe("model");
    expect(edgeSourceFor({ venueFlag: null, previous: { playerStatus: "active", teammateOut: false }, playerStatus: "active", teammateOut: false })).toBe("model");
  });

  it("prefers venue over news", () => {
    expect(edgeSourceFor({ venueFlag: "soft", previous: { playerStatus: null, teammateOut: false }, playerStatus: "out", teammateOut: false })).toBe("venue");
  });
});

describe("fitLogistic and stackingFit", () => {
  it("recovers known coefficients from data generated by them", () => {
    // y ~ Bernoulli(sigmoid(0.3 + 1.0·x1 + 0·x2)), deterministic draws.
    const rand = mulberry32(42);
    const x: number[][] = [];
    const y: boolean[] = [];
    for (let i = 0; i < 4000; i++) {
      const x1 = (rand() - 0.5) * 4;
      const x2 = (rand() - 0.5) * 4;
      x.push([x1, x2]);
      y.push(rand() < 1 / (1 + Math.exp(-(0.3 + 1.0 * x1))));
    }
    const b = fitLogistic(x, y)!;
    expect(b[0]).toBeCloseTo(0.3, 0);
    expect(b[1]).toBeCloseTo(1.0, 0);
    expect(Math.abs(b[2])).toBeLessThan(0.15);
  });

  it("gives the market weight and no model weight when outcomes follow the market", () => {
    const rand = mulberry32(7);
    const items: SkillItem[] = Array.from({ length: 3000 }, (_, i) => {
      const pMarket = 0.3 + 0.4 * rand();
      return { pMarket, pModel: 0.3 + 0.4 * rand(), over: rand() < pMarket, cluster: `g${i % 60}`, propType: "Receptions" };
    });
    const r = stackingFit(items, { reps: 100 })!;
    expect(r.coef[1]).toBeGreaterThan(0.5);
    expect(r.intervals![2].lo).toBeLessThan(0);
    expect(r.intervals![2].hi).toBeGreaterThan(0);
  });

  it("clamps logit at the edges", () => {
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(logit(0.5)).toBeCloseTo(0, 12);
  });
});

describe("overGap", () => {
  it("is Overs landed minus the books' expected Overs, in points", () => {
    // Books 0.5 and 0.6; one Over landed: (1 − 0.5 + 0 − 0.6) / 2 = −0.05.
    expect(overGapPts([{ over: true, pMarket: 0.5 }, { over: false, pMarket: 0.6 }])).toBeCloseTo(-5, 10);
  });

  it("counts games and gives an interval", () => {
    const xs = Array.from({ length: 30 }, (_, i) => item(0.5, 0.5, i % 2 === 0, `g${i % 6}`));
    const g = overGap(xs, { reps: 100 })!;
    expect(g.games).toBe(6);
    expect(g.interval!.lo).toBeLessThanOrEqual(g.gapPts);
  });
});
