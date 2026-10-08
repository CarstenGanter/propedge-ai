import { describe, expect, it } from "vitest";
import {
  boardValue,
  onePerPlayer,
  expectedValueAtUnderdog,
  fitUnderdogPricing,
  perTypeCap,
  PRIOR_PRICING,
  selectWithTypeCap,
  type PricePoint,
} from "./boardSelection";

// The 21 real (books, payout) pairs entered through 2026-09-28.
const REAL: PricePoint[] = [
  [0.505, 1.87], [0.527, 1.78], [0.535, 1.87], [0.551, 1.62], [0.551, 1.71], [0.555, 1.62],
  [0.558, 1.62], [0.563, 1.64], [0.565, 1.61], [0.579, 1.52], [0.579, 1.55], [0.583, 1.52],
  [0.584, 1.55], [0.589, 1.52], [0.592, 1.54], [0.597, 1.54], [0.605, 1.5], [0.608, 1.48],
  [0.615, 1.48], [0.636, 1.41], [0.655, 1.44],
].map(([books, payout]) => ({ books, payout }));

describe("fitUnderdogPricing", () => {
  it("learns from real entries that Underdog keeps more on likelier picks", () => {
    const fit = fitUnderdogPricing(REAL);
    expect(fit.source).toBe("learned");
    expect(fit.n).toBe(21);
    expect(fit.slope).toBeLessThan(0);
    expect(expectedValueAtUnderdog(0.5, fit)).toBeCloseTo(0.935, 2);
    expect(expectedValueAtUnderdog(0.65, fit)).toBeCloseTo(0.896, 2);
  });

  it("matches the built-in prior, which was fitted on the same data", () => {
    const fit = fitUnderdogPricing(REAL);
    expect(fit.intercept).toBeCloseTo(PRIOR_PRICING.intercept, 2);
    expect(fit.slope).toBeCloseTo(PRIOR_PRICING.slope, 2);
  });

  it("falls back to the prior on too few points or no spread", () => {
    expect(fitUnderdogPricing(REAL.slice(0, 5)).source).toBe("prior");
    expect(fitUnderdogPricing(Array.from({ length: 12 }, () => ({ books: 0.55, payout: 1.7 }))).source).toBe("prior");
  });

  it("ignores impossible points", () => {
    const junk = [...REAL, { books: 2, payout: 1.5 }, { books: 0.6, payout: 0.5 }, { books: Number.NaN, payout: 1.8 }];
    expect(fitUnderdogPricing(junk).n).toBe(21);
  });

  it("never predicts an edge from pricing alone", () => {
    for (const b of [0.5, 0.55, 0.6, 0.7]) expect(expectedValueAtUnderdog(b)).toBeLessThan(1);
  });
});

describe("selectWithTypeCap", () => {
  const item = (id: string, type: string) => ({ id, type });

  it("stops one prop type taking over the board", () => {
    // The 2026-09-28 shape: receptions first in line, yardage behind them.
    // That slate had 26 yardage props, plenty to fill the board.
    const ordered = [
      ...["r1", "r2", "r3", "r4", "r5", "r6"].map((id) => item(id, "Receptions")),
      ...["y1", "y2", "y3"].map((id) => item(id, "Receiving Yards")),
      ...["u1", "u2", "u3"].map((id) => item(id, "Rushing Yards")),
    ];
    const chosen = selectWithTypeCap(ordered, (x) => x.type, 6).map((x) => x.id);
    expect(chosen).toHaveLength(6);
    for (const prefix of ["r", "y", "u"]) {
      expect(chosen.filter((id) => id.startsWith(prefix))).toHaveLength(perTypeCap(6));
    }
  });

  it("still fills the board when there aren't enough types", () => {
    const ordered = ["a", "b", "c", "d", "e"].map((id) => item(id, "Receptions"));
    expect(selectWithTypeCap(ordered, (x) => x.type, 4)).toHaveLength(4);
  });

  it("keeps the given order within the cap", () => {
    const ordered = [item("a", "X"), item("b", "Y"), item("c", "X")];
    expect(selectWithTypeCap(ordered, (x) => x.type, 3).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("boardValue", () => {
  const curve = (p: number) => expectedValueAtUnderdog(p);

  it("ranks a soft line by the standard payout, not the favourite discount the curve assumes", () => {
    // George Holani, 2026-10-04: books 54.9% at Underdog's 9.5, in the base market.
    const soft = boardValue({ marketProb: 0.549, underdogLine: 9.5, underdogPayout: null, reliable: true, predicted: curve });
    expect(soft).toBeCloseTo(0.549 * 1.87, 6);
    expect(soft).toBeGreaterThan(1.02);
    // Without the line, the curve would have priced it as a discounted favourite.
    expect(boardValue({ marketProb: 0.549, underdogLine: null, underdogPayout: null, reliable: true, predicted: curve })).toBeLessThan(1);
  });

  it("uses an entered payout when there is one", () => {
    expect(boardValue({ marketProb: 0.6, underdogLine: 3.5, underdogPayout: 1.54, reliable: true, predicted: curve })).toBeCloseTo(0.924, 6);
  });

  it("caps a thin market at break-even", () => {
    // Emanuel Wilson, 2026-10-04: 1.189 on paper, from fewer than three books.
    expect(boardValue({ marketProb: 0.636, underdogLine: 5.5, underdogPayout: null, reliable: false, predicted: curve })).toBe(1);
  });
});

describe("onePerPlayer", () => {
  it("keeps each player's best-ranked prop only", () => {
    const ordered = [
      { p: "Emanuel Wilson", t: "Receiving Yards" },
      { p: "George Holani", t: "Receiving Yards" },
      { p: "Emanuel Wilson", t: "Rushing Yards" },
      { p: "emanuel wilson ", t: "Rush+Rec Yards" },
    ];
    expect(onePerPlayer(ordered, (x) => x.p).map((x) => `${x.p}:${x.t}`)).toEqual([
      "Emanuel Wilson:Receiving Yards",
      "George Holani:Receiving Yards",
    ]);
  });
});
