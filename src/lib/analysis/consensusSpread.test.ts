import { describe, expect, it } from "vitest";
import { affineSpread, CV_PRIOR_SPREAD, devigLadder, FITTED_SPREAD, fitAffineSigma, ladderLoss, type Ladder } from "./consensusSpread";
import { buildConsensus, consensusProbOver, LINE_SHIFT_TRUST, powerDevig, type RawQuote } from "./marketConsensus";

/** A synthetic ladder priced from a known spread, to check the fit recovers it. */
function syntheticLadder(mainLine: number, spread: ReturnType<typeof affineSpread>): Ladder {
  const main: RawQuote[] = [
    { book: "fanduel", line: mainLine, over: -110, under: -110 },
    { book: "draftkings", line: mainLine, over: -112, under: -108 },
  ];
  const m = buildConsensus("Receiving Yards", main, { spread }).model!;
  const rungs = [-20, -10, -5, 5, 10, 20, 30].map((d) => mainLine + d).filter((l) => l > 0).map((line) => ({ line, pOver: consensusProbOver(m, line) }));
  return { propType: "Receiving Yards", main, rungs };
}

describe("the spread is pluggable without changing the default", () => {
  it("uses the fitted spread in production for receiving yards and the CV prior elsewhere", () => {
    const rec: RawQuote[] = [{ book: "fanduel", line: 30.5, over: -110, under: -110 }];
    const prodRec = buildConsensus("Receiving Yards", rec).model!;
    const fitRec = buildConsensus("Receiving Yards", rec, { spread: FITTED_SPREAD }).model!;
    expect(prodRec.sigma).toBeCloseTo(fitRec.sigma, 12);
    expect(consensusProbOver(prodRec, 40.5)).toBeCloseTo(consensusProbOver(fitRec, 40.5), 12);
    const rush: RawQuote[] = [{ book: "fanduel", line: 30.5, over: -110, under: -110 }];
    const prodRush = buildConsensus("Rushing Yards", rush).model!;
    const cvRush = buildConsensus("Rushing Yards", rush, { spread: CV_PRIOR_SPREAD }).model!;
    expect(prodRush.sigma).toBeCloseTo(cvRush.sigma, 12);
    expect(consensusProbOver(prodRush, 40.5)).toBeCloseTo(consensusProbOver(cvRush, 40.5), 12);
  });

  it("keeps the old receiving-yards reading available for comparison", () => {
    const rec: RawQuote[] = [{ book: "fanduel", line: 3.5, over: -110, under: -110 }];
    const old = buildConsensus("Receiving Yards", rec, { spread: CV_PRIOR_SPREAD }).model!;
    const prod = buildConsensus("Receiving Yards", rec).model!;
    // The 85% Under 14.5 off a 3.5 line was the old reading; the fitted spread is far less extreme.
    expect(1 - consensusProbOver(old, 14.5)).toBeGreaterThan(0.84);
    expect(1 - consensusProbOver(prod, 14.5)).toBeLessThan(0.8);
  });

  it("drops the line-shift damping for a fitted prop type only", () => {
    const s = affineSpread({ "Receiving Yards": { a: 8, b: 0.4 } });
    expect(s.sigma("Receiving Yards", 30)).toBeCloseTo(20, 12);
    expect(s.lineShiftTrust("Receiving Yards")).toBeNull();
    expect(s.lineShiftTrust("Rushing Yards")).toBeUndefined();
    expect(LINE_SHIFT_TRUST["Rushing Yards"]).toBe(0.7);
  });
});

describe("devigLadder", () => {
  it("de-vigs a book's alternates with the exponent of its own main line", () => {
    const main: RawQuote[] = [{ book: "fanduel", line: 44.5, over: -115, under: -105 }];
    const rungs = devigLadder(main, [
      { book: "fanduel", line: 44.5, over: -115 },
      { book: "fanduel", line: 59.5, over: 180 },
      { book: "draftkings", line: 59.5, over: 175 }, // no main quote to read its margin from
      { book: "prizepicks", line: 59.5, over: 100 }, // a venue, never a target
    ]);
    expect(rungs).toHaveLength(2);
    expect(rungs[0].pOver).toBeCloseTo(powerDevig(-115, -105)!, 12);
    expect(rungs[1].pOver).toBeLessThan(1 / 2.8); // the margin comes off
  });
});

describe("fitAffineSigma", () => {
  it("recovers the spread a ladder was priced from", () => {
    const truth = affineSpread({ "Receiving Yards": { a: 12, b: 0.35 } });
    const ladders = [8.5, 14.5, 24.5, 39.5, 54.5, 69.5, 84.5].map((l) => syntheticLadder(l, truth));
    const fit = fitAffineSigma("Receiving Yards", ladders);
    expect(fit.sse).toBeLessThan(1e-4);
    expect(fit.a).toBeCloseTo(12, 0);
    expect(fit.b).toBeCloseTo(0.35, 1);
  });

  it("beats today's spread on ladders that are wider at low lines", () => {
    const truth = affineSpread({ "Receiving Yards": { a: 12, b: 0.35 } });
    const ladders = [4.5, 9.5, 14.5].map((l) => syntheticLadder(l, truth));
    expect(fitAffineSigma("Receiving Yards", ladders).sse).toBeLessThan(ladderLoss(ladders, CV_PRIOR_SPREAD).sse);
  });

  it("uses only ladders of the prop type being fitted", () => {
    const l = { ...syntheticLadder(30.5, affineSpread({ "Receiving Yards": { a: 10, b: 0.3 } })), propType: "Rushing Yards" };
    expect(fitAffineSigma("Receiving Yards", [l]).ladders).toBe(0);
  });
});
