import { describe, expect, it } from "vitest";
import { CV_PRIOR_SPREAD, FITTED_SPREAD, heldOutPriceTest } from "./consensusSpread";
import { buildConsensus, consensusProbOver, type ConsensusSpread, type RawQuote } from "./marketConsensus";

const main: RawQuote[] = ["fanduel", "draftkings", "betmgm", "caesars"].map((book) => ({ book, line: 54.5, over: -110, under: -110 }));
/** Ladders whose rungs are priced exactly by `truth` — so that spread is the right one. */
function laddersPricedBy(truth: ConsensusSpread) {
  const m = buildConsensus("Receiving Yards", main, { spread: truth }).model!;
  return ["g1", "g2", "g3", "g4"].map((game, i) => ({
    propType: "Receiving Yards",
    main,
    rungs: [24.5, 34.5, 44.5, 64.5, 74.5, 84.5 + i].map((line) => ({ book: "fanduel", line, pOver: consensusProbOver(m, line) })),
    game,
  }));
}

describe("heldOutPriceTest", () => {
  it("keeps the fitted spread when it reads held-out ladders better, with the interval below zero", () => {
    const t = heldOutPriceTest(laddersPricedBy(FITTED_SPREAD), FITTED_SPREAD, CV_PRIOR_SPREAD, { reps: 200 });
    expect(t.verdict).toBe("keep");
    expect(t.rmseFitted!).toBeLessThan(t.rmseCurrent!);
    expect(t.interval!.hi).toBeLessThan(0);
    expect(t).toMatchObject({ ladders: 4, rungs: 24, games: 4 });
  });

  it("reverts when the fitted spread doesn't beat the current one", () => {
    const t = heldOutPriceTest(laddersPricedBy(CV_PRIOR_SPREAD), FITTED_SPREAD, CV_PRIOR_SPREAD, { reps: 200 });
    expect(t.verdict).toBe("REVERT");
  });

  it("is pending with no held-out ladders", () => {
    expect(heldOutPriceTest([], FITTED_SPREAD, CV_PRIOR_SPREAD).verdict).toBe("pending");
  });
});
