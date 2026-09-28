import { describe, expect, it } from "vitest";
import { adjustmentsFrom, estimateProbability, MAX_PROB, MIN_PROB, type ProbabilityInputs } from "./probabilityModel";
import type { ResearchBundle, ScorablePropInput } from "@/types";

const games = (n: number, value: number) => Array.from({ length: n }, () => value);

describe("estimateProbability", () => {
  it("returns null without a sample", () => {
    expect(estimateProbability({ line: 4.5, direction: "OVER", propType: "Receptions", games: [] })).toBeNull();
  });

  it("puts the two sides of a prop at exactly 1", () => {
    const base = { line: 60.5, propType: "Receiving Yards", games: [70, 55, 80, 45, 65, 72] };
    const over = estimateProbability({ ...base, direction: "OVER" })!;
    const under = estimateProbability({ ...base, direction: "UNDER" })!;
    expect(over.probability + under.probability).toBeCloseTo(1, 9);
  });

  it("produces realistic edges, not 80% certainties", () => {
    // A player averaging 68 against a 60.5 line is a real edge — and is still
    // only about a 60% proposition. The old score read this as ~80.
    const e = estimateProbability({
      line: 60.5,
      direction: "OVER",
      propType: "Receiving Yards",
      games: [68, 68, 68, 68, 68, 68, 68, 68],
    })!;
    expect(e.probability).toBeGreaterThan(0.52);
    expect(e.probability).toBeLessThan(0.7);
  });

  it("rises with the projection and falls with the line", () => {
    const mk = (line: number, value: number) =>
      estimateProbability({ line, direction: "OVER", propType: "Receiving Yards", games: games(8, value) })!.probability;
    expect(mk(60.5, 80)).toBeGreaterThan(mk(60.5, 65));
    expect(mk(75.5, 70)).toBeLessThan(mk(55.5, 70));
  });

  it("never claims more than the market plausibly allows", () => {
    const wild = estimateProbability({
      line: 10.5,
      direction: "OVER",
      propType: "Receiving Yards",
      games: games(10, 200),
    })!;
    expect(wild.probability).toBeLessThanOrEqual(MAX_PROB);
    expect(wild.clipped).toBe(true);
    expect(wild.note).toMatch(/Clipped/);

    const hopeless = estimateProbability({
      line: 200.5,
      direction: "OVER",
      propType: "Receiving Yards",
      games: games(10, 10),
    })!;
    expect(hopeless.probability).toBeGreaterThanOrEqual(MIN_PROB);
  });

  it("anchors to the market when a de-vigged price is available", () => {
    const withoutMarket = estimateProbability({
      line: 4.5,
      direction: "OVER",
      propType: "Receptions",
      games: games(3, 8), // a hot, small sample
    })!;
    const withMarket = estimateProbability({
      line: 4.5,
      direction: "OVER",
      propType: "Receptions",
      games: games(3, 8),
      marketProbOver: 0.5,
      marketLine: 4.5,
    })!;
    expect(withMarket.usedMarket).toBe(true);
    // The market pulls an over-excited small sample back toward the line.
    expect(withMarket.projection).toBeLessThan(withoutMarket.projection);
    expect(withMarket.probability).toBeLessThan(withoutMarket.probability);
  });

  it("trusts a large sample more than the market", () => {
    const small = estimateProbability({
      line: 4.5, direction: "OVER", propType: "Receptions",
      games: games(2, 8), marketProbOver: 0.5, marketLine: 4.5,
    })!;
    const large = estimateProbability({
      line: 4.5, direction: "OVER", propType: "Receptions",
      games: games(16, 8), marketProbOver: 0.5, marketLine: 4.5,
    })!;
    expect(large.projection).toBeGreaterThan(small.projection);
  });

  it("is less confident on a thin sample, via fatter t tails", () => {
    const thin = estimateProbability({ line: 60.5, direction: "OVER", propType: "Receiving Yards", games: games(3, 75) })!;
    const thick = estimateProbability({ line: 60.5, direction: "OVER", propType: "Receiving Yards", games: games(15, 75) })!;
    expect(thin.probability).toBeLessThan(thick.probability);
  });

  it("treats a counting prop as discrete: the line is a threshold", () => {
    // Receptions 4.5 means 5+. Mean 5 with modest spread is near 56%.
    const e = estimateProbability({ line: 4.5, direction: "OVER", propType: "Receptions", games: [5, 5, 5, 4, 6, 5] })!;
    expect(e.probability).toBeGreaterThan(0.5);
    expect(e.probability).toBeLessThan(0.65);
  });

  it("caps how far context can move the projection", () => {
    const huge = estimateProbability({
      line: 60.5, direction: "OVER", propType: "Receiving Yards",
      games: games(8, 60), adjustments: [0.5, 0.5, 0.5],
    })!;
    // 15% cap, so the projection cannot run away from the sample.
    expect(huge.projection).toBeLessThanOrEqual(60 * 1.15 + 1e-6);
  });

  it("never returns NaN across a wide sweep", () => {
    for (const propType of ["Receptions", "Receiving Yards", "Pass TDs", "Rush+Rec Yards"]) {
      for (const line of [0.5, 1.5, 4.5, 60.5, 250.5]) {
        for (const n of [1, 2, 5, 17]) {
          const e = estimateProbability({ line, direction: "OVER", propType, games: games(n, line) });
          if (!e) continue;
          expect(Number.isFinite(e.probability)).toBe(true);
          expect(e.probability).toBeGreaterThanOrEqual(MIN_PROB);
          expect(e.probability).toBeLessThanOrEqual(MAX_PROB);
        }
      }
    }
  });
});

describe("adjustmentsFrom", () => {
  const prop: ScorablePropInput = {
    sport: "NFL", league: "NFL", playerName: "p", team: "A", opponent: "B",
    propType: "Receiving Yards", line: 60.5, direction: "OVER",
  };

  it("reads a soft matchup as positive and a tough one as negative", () => {
    const soft: ResearchBundle = { matchup: { opponentDefenseRank: 32, leagueSize: 32, source: "s" } };
    const tough: ResearchBundle = { matchup: { opponentDefenseRank: 1, leagueSize: 32, source: "s" } };
    expect(adjustmentsFrom(prop, soft).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(adjustmentsFrom(prop, tough).reduce((a, b) => a + b, 0)).toBeLessThan(0);
  });

  it("gives the same projection nudge regardless of which side is being priced", () => {
    // The projection is direction-free, so an UNDER must not flip the matchup.
    const bundle: ResearchBundle = { matchup: { opponentDefenseRank: 30, leagueSize: 32, environmentFavor: 0.5, source: "s" } };
    const over = adjustmentsFrom({ ...prop, direction: "OVER" }, bundle).reduce((a, b) => a + b, 0);
    const under = adjustmentsFrom(
      { ...prop, direction: "UNDER" },
      { matchup: { ...bundle.matchup!, environmentFavor: -0.5 } },
    ).reduce((a, b) => a + b, 0);
    expect(over).toBeCloseTo(under, 9);
  });

  it("docks a doubtful player and a part-time role", () => {
    expect(adjustmentsFrom(prop, { news: { playerStatus: "doubtful", source: "s" } })[0]).toBeLessThan(0);
    const partTime: ResearchBundle = {
      playerStats: { recentGames: [], snapPct: 0.3, source: "s" },
    };
    expect(adjustmentsFrom(prop, partTime).reduce((a, b) => a + b, 0)).toBeLessThan(0);
  });
});

describe("market anchoring", () => {
  it("reproduces the market's own probability when the line matches and nothing else fires", () => {
    // The whole point of solving for the projection rather than inverting a
    // normal: with no line difference and no context, we should agree with the
    // market rather than overrule it.
    for (const [propType, line, pOver] of [
      ["Receiving Yards", 60.5, 0.57],
      ["Receiving Yards", 82.5, 0.44],
      ["Receptions", 4.5, 0.61],
      ["Rush+Rec Yards", 88.5, 0.52],
    ] as const) {
      const e = estimateProbability({
        line, direction: "OVER", propType,
        games: games(15, line), // sample sitting exactly on the line
        marketProbOver: pOver, marketLine: line,
      })!;
      // Lands close to the market, pulled toward the player's own sample — here
      // a sample sitting exactly on the line, i.e. arguing for 50/50. A gap of
      // a few points is the shrinkage working; landing on the other side of the
      // market's call would not be.
      expect(Math.abs(e.probability - pOver)).toBeLessThan(0.08);
      expect(Math.sign(e.probability - 0.5)).toBe(Math.sign(pOver - 0.5));
    }
  });

  it("departs from the market only for a line difference or real context", () => {
    const common = { propType: "Receptions", direction: "OVER" as const, games: games(15, 4.5), marketProbOver: 0.55, marketLine: 4.5 };
    const same = estimateProbability({ ...common, line: 4.5 })!;
    const softer = estimateProbability({ ...common, line: 3.5 })!;
    const tougher = estimateProbability({ ...common, line: 5.5 })!;
    expect(softer.probability).toBeGreaterThan(same.probability);
    expect(tougher.probability).toBeLessThan(same.probability);
  });

  it("lets the market pull a disagreeing sample back toward reality", () => {
    const realistic = [4, 9, 2, 14, 6, 3, 11, 5, 8, 1, 7, 12, 4, 6, 9]; // mean 6.7
    const anchored = estimateProbability({
      line: 11.5, direction: "UNDER", propType: "Receiving Yards",
      games: realistic,
      marketProbOver: 0.497, marketLine: 11.5, // market says coin flip
    })!;
    const unanchored = estimateProbability({
      line: 11.5, direction: "UNDER", propType: "Receiving Yards",
      games: realistic,
    })!;
    // The market must move it meaningfully toward 50/50.
    expect(anchored.probability).toBeLessThan(unanchored.probability);
    expect(anchored.usedMarket).toBe(true);
  });
});

// 2026-09-27: every adjustment was applied on top of a market-anchored
// projection, so context the market had already priced was counted twice.
// Picks the model rated 8+ points above the market went 3 for 8.
/** The same inputs with the market price removed. */
function withoutMarket(x: ProbabilityInputs): ProbabilityInputs {
  return { ...x, marketProbOver: undefined, marketLine: undefined };
}

describe("context adjustments do not double-count the market", () => {
  const base = {
    line: 60.5, direction: "OVER" as const, propType: "Receiving Yards",
    games: games(10, 60.5), marketProbOver: 0.505, marketLine: 60.5,
  };

  it("keeps a coin-flip market near a coin flip even with every adjustment maxed out", () => {
    const plain = estimateProbability(base)!;
    const maxed = estimateProbability({ ...base, adjustments: [0.5] })!; // capped at +15%
    expect(maxed.probability).toBeGreaterThan(plain.probability); // context still counts...
    // ...but can't invent an edge: ~3 points at most with every adjustment
    // maxed, where applying them on top of the market used to give ~10.
    expect(maxed.probability - base.marketProbOver).toBeLessThan(0.04);
  });

  it("still lets context move the estimate fully when there is no market to lean on", () => {
    const noMarket = withoutMarket(base);
    const plain = estimateProbability(noMarket)!;
    const maxed = estimateProbability({ ...noMarket, adjustments: [0.5] })!;
    expect(maxed.projection).toBeCloseTo(plain.projection * 1.15, 6);
  });

  it("reports what the market implies at the line being played", () => {
    const e = estimateProbability(base)!;
    expect(e.marketProbability).toBeCloseTo(0.505, 2);
    expect(estimateProbability({ ...base, direction: "UNDER" })!.marketProbability).toBeCloseTo(0.495, 2);
    const noMarket = withoutMarket(base);
    expect(estimateProbability(noMarket)!.marketProbability).toBeNull();
  });

  it("defers to the market over a hot sample, and moves for a better line", () => {
    // A player averaging 145 yards against a 60.5 line the market calls a coin
    // flip: the market is still the better forecast.
    const hot = estimateProbability({ ...base, games: [140, 150, 145], adjustments: [0.15] })!;
    expect(Math.abs(hot.probability - hot.marketProbability!)).toBeLessThan(0.02);
    // What does move it is playing a softer line than the books priced.
    const softer = estimateProbability({ ...base, line: 55.5 })!;
    expect(softer.probability - base.marketProbOver).toBeGreaterThan(0.04);
    expect(softer.marketProbability! - base.marketProbOver).toBeGreaterThan(0.04); // the market agrees at that line
  });
});
