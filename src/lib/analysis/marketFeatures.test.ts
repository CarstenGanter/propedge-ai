import { describe, expect, it } from "vitest";
import { marketFeatures } from "./marketFeatures";
import { buildConsensus, type RawQuote } from "./marketConsensus";

const fresh = "2026-10-18T15:00:00Z";
const quotes = (overrides: Partial<Record<string, Partial<RawQuote>>> = {}): RawQuote[] =>
  [
    { book: "fanduel", line: 44.5, over: -110, under: -110, lastUpdate: fresh },
    { book: "draftkings", line: 44.5, over: -110, under: -110, lastUpdate: fresh },
    { book: "betmgm", line: 44.5, over: -110, under: -110, lastUpdate: fresh },
  ].map((q) => ({ ...q, ...(overrides[q.book] ?? {}) }));

describe("venue gap", () => {
  const model = buildConsensus("Receiving Yards", quotes()).model!;

  it("is signed so positive means easier for the side, in σ and stat units", () => {
    const over = marketFeatures({ propType: "Receiving Yards", quotes: quotes(), venueLine: 42.5, direction: "OVER" })!;
    expect(over.venueGapUnits).toBeCloseTo(2, 10);
    expect(over.venueGapSigma).toBeCloseTo(2 / model.sigma, 10);
    const under = marketFeatures({ propType: "Receiving Yards", quotes: quotes(), venueLine: 42.5, direction: "UNDER" })!;
    expect(under.venueGapUnits).toBeCloseTo(-2, 10);
  });

  it("reads zero where the venue posts the books' line, even on a count prop", () => {
    const rec: RawQuote[] = [
      { book: "fanduel", line: 1.5, over: -130, under: 100 },
      { book: "draftkings", line: 1.5, over: -125, under: -105 },
    ];
    expect(marketFeatures({ propType: "Receptions", quotes: rec, venueLine: 1.5, direction: "UNDER" })!.venueGapUnits).toBe(0);
  });

  it("is null without a venue line", () => {
    expect(marketFeatures({ propType: "Receiving Yards", quotes: quotes() })!.venueGapSigma).toBeNull();
  });
});

describe("group dispersion", () => {
  it("is zero when every group agrees and grows when one disagrees", () => {
    expect(marketFeatures({ propType: "Receiving Yards", quotes: quotes() })!.groupDispersion).toBeCloseTo(0, 10);
    // One group 3 yards off on a σ of ~27: a spread of about 0.045σ.
    const apart = marketFeatures({ propType: "Receiving Yards", quotes: quotes({ betmgm: { line: 47.5 } }) })!;
    expect(apart.groupDispersion!).toBeGreaterThan(0.03);
    expect(apart.groupDispersion!).toBeLessThan(0.08);
  });

  it("counts books sharing a pricing source once", () => {
    // betrivers and ballybet share Kambi: two books, one group, so no spread between groups.
    const kambi: RawQuote[] = [
      { book: "betrivers", line: 44.5, over: -110, under: -110 },
      { book: "ballybet", line: 44.5, over: -110, under: -110 },
    ];
    expect(marketFeatures({ propType: "Receiving Yards", quotes: kambi })!.groupDispersion).toBeNull();
  });
});

describe("staleness", () => {
  it("measures the oldest quote against the fetch time and flags stale groups by the 6-hour rule", () => {
    const f = marketFeatures({
      propType: "Receiving Yards",
      quotes: quotes({ betmgm: { lastUpdate: "2026-10-18T07:00:00Z" } }),
      fetchedAt: new Date("2026-10-18T15:30:00Z"),
    })!;
    expect(f.oldestQuoteMinutes).toBeCloseTo(8.5 * 60, 6);
    expect(f.staleGroups).toEqual(["betmgm"]);
  });

  it("is unknown for quotes stored without book timestamps", () => {
    const f = marketFeatures({ propType: "Receiving Yards", quotes: quotes().map((q) => ({ ...q, lastUpdate: undefined })) })!;
    expect(f.oldestQuoteMinutes).toBeNull();
    expect(f.staleGroups).toEqual([]);
  });
});
