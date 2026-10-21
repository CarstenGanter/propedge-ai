import { describe, expect, it } from "vitest";
import { buildConsensus, consensusProbOver } from "@/lib/analysis/marketConsensus";
import { buildLivePrediction, marketMethodOf, overProb } from "./predictionLog";
import type { MarketSnapshot } from "./marketSnapshot";

const { model } = buildConsensus("Receiving Yards", [
  { book: "fanduel", line: 30.5, over: -115, under: -105 },
  { book: "draftkings", line: 30.5, over: -112, under: -108 },
  { book: "betmgm", line: 31.5, over: -105, under: -115 },
]);
const snapshot: MarketSnapshot = { v: 2, quotes: [{ book: "fanduel", line: 30.5, over: -115, under: -105, status: "used" }], fetchedAt: "2026-10-18T14:00:00.000Z" };
const prop = { id: "p1", line: 30.5, underdogLine: null as number | null, direction: "UNDER", updatedAt: new Date("2026-10-18T15:00:00Z") };
const base = {
  prop,
  modelProbability: 0.54,
  modelRawProbability: 0.54,
  consensus: model,
  snapshot,
  playerStatus: null,
  teammateOut: false,
  previous: null,
  modelVersion: "v1.7.0",
};

describe("buildLivePrediction", () => {
  it("logs P(over) for both model and market at the same line", () => {
    const row = buildLivePrediction(base)!;
    expect(row.modelProbOver).toBeCloseTo(0.46, 12); // UNDER 54% → over 46%
    expect(row.marketProbOver).toBeCloseTo(consensusProbOver(model!, 30.5), 12);
    expect(row).toMatchObject({ line: 30.5, lineKind: "reference", source: "live", marketMethod: "consensus-v2", edgeSource: "model" });
  });

  it("is as of the quotes' fetch time, or unknown — never the prop's last update", () => {
    expect(buildLivePrediction(base)!.quotedAt).toEqual(new Date("2026-10-18T14:00:00.000Z"));
    // updatedAt moves with any write (a settlement, an edit), so it's no quote time.
    expect(buildLivePrediction({ ...base, snapshot: { v: 2 } })!.quotedAt).toBeNull();
  });

  it("scores at Underdog's line once known, and calls a soft line a venue edge", () => {
    const row = buildLivePrediction({ ...base, prop: { ...prop, underdogLine: 32.5 } })!;
    expect(row).toMatchObject({ line: 32.5, lineKind: "venue", edgeSource: "venue" });
    expect(row.marketProbOver).toBeCloseTo(consensusProbOver(model!, 32.5), 12);
  });

  it("calls a status change since the last forecast news", () => {
    const row = buildLivePrediction({ ...base, playerStatus: "questionable", previous: { playerStatus: null, teammateOut: false } })!;
    expect(row.edgeSource).toBe("news");
  });

  it("logs nothing without a model probability or a market", () => {
    expect(buildLivePrediction({ ...base, modelProbability: null })).toBeNull();
    expect(buildLivePrediction({ ...base, consensus: null })).toBeNull();
  });
});

describe("helpers", () => {
  it("tells the market methods apart by whether per-book quotes were stored", () => {
    expect(marketMethodOf(snapshot)).toBe("consensus-v2");
    expect(marketMethodOf({ v: 1, noVigProbOver: 0.5 })).toBe("novig-v1");
    expect(marketMethodOf(null)).toBe("novig-v1");
  });

  it("turns a side probability into P(over)", () => {
    expect(overProb(0.6, "OVER")).toBe(0.6);
    expect(overProb(0.6, "UNDER")).toBeCloseTo(0.4, 12);
  });
});
