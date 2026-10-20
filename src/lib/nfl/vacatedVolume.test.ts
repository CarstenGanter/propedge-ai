import { describe, expect, it } from "vitest";
import { fitRedistribution, learned, noShift, proRata, redistribute, type ShareObs } from "./vacatedVolume";

const obs = (o: Partial<ShareObs>): ShareObs => ({
  teamGame: "t",
  pos: "WR",
  prior: 0.2,
  observed: 0.2,
  teamVolume: 35,
  vacated: {},
  groupPriorSum: 0.4,
  groupCount: 2,
  activePriorSum: 0.8,
  ...o,
});

describe("baselines", () => {
  it("leaves shares alone with no redistribution", () => {
    expect(noShift(obs({ prior: 0.18 }))).toBe(0.18);
  });

  it("hands the vacated share out pro rata to active players", () => {
    // 0.2 of 0.8 active share → a quarter of the 0.2 vacated.
    expect(proRata(obs({ vacated: { WR: 0.2 } }))).toBeCloseTo(0.25, 12);
  });
});

describe("learned", () => {
  it("sends M[from][to] of the vacancy to the group, split by prior share + δ", () => {
    const r = { matrix: { WR: { WR: 0.8 } }, delta: 0 };
    // Half the WR group's prior share → half of 0.8 × 0.2.
    expect(learned(obs({ vacated: { WR: 0.2 } }), r)).toBeCloseTo(0.2 + 0.08, 12);
  });

  it("splits evenly inside the group when δ is infinite", () => {
    const r = { matrix: { WR: { WR: 1 } }, delta: Infinity };
    expect(learned(obs({ prior: 0.3, groupPriorSum: 0.4, groupCount: 4, vacated: { WR: 0.2 } }), r)).toBeCloseTo(0.3 + 0.05, 12);
  });

  it("lets a zero-share backup absorb some through δ", () => {
    const r = { matrix: { WR: { WR: 1 } }, delta: 0.1 };
    const backup = learned(obs({ prior: 0, groupPriorSum: 0.3, groupCount: 2, vacated: { WR: 0.2 } }), r);
    expect(backup).toBeCloseTo(0.2 * (0.1 / (0.3 + 0.2)), 12);
  });
});

describe("fitRedistribution", () => {
  it("recovers a matrix the data were generated from", () => {
    const truth = { matrix: { WR: { WR: 0.7, TE: 0.2 }, TE: { WR: 0.3, TE: 0.6 } }, delta: 0.02 };
    const data: ShareObs[] = [];
    for (let g = 0; g < 200; g++) {
      for (const pos of ["WR", "TE"]) {
        const o = obs({
          teamGame: `g${g}`,
          pos,
          prior: 0.05 + (g % 7) * 0.03,
          groupPriorSum: 0.4 + (g % 5) * 0.05,
          groupCount: 2 + (g % 3),
          vacated: g % 2 ? { WR: 0.1 + (g % 4) * 0.05 } : { TE: 0.08 + (g % 3) * 0.04 },
        });
        o.observed = learned(o, truth);
        data.push(o);
      }
    }
    const fit = fitRedistribution(data, ["WR", "TE", "RB"], [0, 0.02, 0.05]);
    expect(fit.delta).toBe(0.02);
    expect(fit.matrix.WR.WR).toBeCloseTo(0.7, 6);
    expect(fit.matrix.TE.WR).toBeCloseTo(0.3, 6);
    expect(fit.matrix.RB).toEqual({}); // never vacated in the data: no guess
  });
});

describe("non-negativity", () => {
  it("never fits a negative share of a vacancy", () => {
    // Observed shares fall when TEs are out (game script): least squares would go negative.
    const data = Array.from({ length: 60 }, (_, g) =>
      obs({ teamGame: `g${g}`, pos: "RB", prior: 0.1, observed: 0.08, vacated: { TE: 0.15 }, groupPriorSum: 0.2, groupCount: 2 }),
    );
    const fit = fitRedistribution(data, ["TE", "RB"], [0]);
    expect(fit.matrix.TE.RB).toBe(0);
  });
});

describe("redistribute", () => {
  it("gives each active player his expected share once the out player's is moved", () => {
    const r = { matrix: { WR: { WR: 0.8, TE: 0.2 } }, delta: 0 };
    const shares = redistribute(
      [
        { id: "wr1", pos: "WR", prior: 0.25, active: false },
        { id: "wr2", pos: "WR", prior: 0.2, active: true },
        { id: "wr3", pos: "WR", prior: 0.1, active: true },
        { id: "te1", pos: "TE", prior: 0.15, active: true },
      ],
      r,
    );
    expect(shares.get("wr2")).toBeCloseTo(0.2 + 0.25 * 0.8 * (0.2 / 0.3), 12);
    expect(shares.get("te1")).toBeCloseTo(0.15 + 0.25 * 0.2, 12);
    expect(shares.has("wr1")).toBe(false);
  });
});
