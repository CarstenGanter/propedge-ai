import { describe, expect, it } from "vitest";
import {
  buildSuggestedSlips,
  correlatedPairsFor,
  pickToSlipCandidate,
  stackRho,
  whyLineFor,
  QB_STACK_RHO,
  type SlipCandidate,
} from "./slipBuilder";
import type { SerializedPick } from "@/lib/dto";
import { makeGameKey } from "./parlayCorrelation";

function cand(
  id: string,
  player: string,
  team: string,
  opp: string,
  conf: number,
  direction: "OVER" | "UNDER" = "OVER",
  teamId: string | null = null,
  propType = "Receiving Yards",
): SlipCandidate {
  return {
    pickId: id,
    playerName: player,
    team,
    opponent: opp,
    gameKey: makeGameKey(team, opp, "2026-09-13"),
    propType,
    direction,
    confidenceScore: conf,
    riskLevel: "Medium",
    line: 60.5,
    sport: "NFL",
    date: "2026-09-13",
    whyLine: "why",
    teamId,
  };
}

describe("buildSuggestedSlips", () => {
  const cands = [
    cand("a", "Alpha WR", "Bengals", "Buccaneers", 80, "OVER", "CIN"),
    cand("b", "Bravo RB", "Lions", "Saints", 78, "OVER", "DET"),
    cand("c", "Charlie TE", "Bengals", "Buccaneers", 76, "OVER", "TB"), // same game as a, opposing team
    cand("d", "Alpha WR", "Bengals", "Buccaneers", 75, "OVER", "CIN"), // same player as a (other prop)
    cand("e", "Echo QB", "Chiefs", "Broncos", 72, "OVER", "KC"),
    cand("f", "Foxtrot WR", "Lions", "Saints", 70, "UNDER", "NO"), // same game as b, opposite direction
  ];

  it("builds slips by confidence from distinct players in distinct games", () => {
    const slips = buildSuggestedSlips(cands, [2, 3]);
    expect(slips.map((s) => s.size)).toEqual([2, 3]);
    expect(slips[0].legs.map((l) => l.pickId)).toEqual(["a", "b"]);
    expect(slips[1].legs.map((l) => l.pickId)).toEqual(["a", "b", "e"]);
    expect(slips[1].flags).toEqual([]);
  });

  it("never repeats a player and never pairs opposite directions from one game", () => {
    const [four] = buildSuggestedSlips(cands, [4]);
    const ids = four.legs.map((l) => l.pickId);
    expect(ids).not.toContain("d"); // same player as a
    expect(ids).not.toContain("f"); // conflicts with b
    expect(ids).toEqual(["a", "b", "e", "c"]);
    expect(four.flags).toHaveLength(1);
    expect(four.flags[0].tone).toBe("info");
    expect(four.flags[0].text).toMatch(/opposing teams/);
  });

  // ---- Underdog platform rules ----

  it("refuses to pair two players from the same game whose teams are unknown", () => {
    // 'c' shares a game with 'a' and neither carries a resolved team id, so
    // they might be team-mates — which the platform would reject.
    const onlyOneGame = [cand("a", "Alpha WR", "Bengals", "Buccaneers", 80), cand("c", "Charlie TE", "Bengals", "Buccaneers", 76)];
    expect(buildSuggestedSlips(onlyOneGame, [2])).toEqual([]);
  });

  it("allows same-game legs once they are known to be on opposing teams", () => {
    const opposing = [
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 80, "OVER", "CIN"),
      cand("c", "Charlie TE", "Bengals", "Buccaneers", 76, "OVER", "TB"),
    ];
    const [two] = buildSuggestedSlips(opposing, [2]);
    expect(two.legs.map((l) => l.pickId)).toEqual(["a", "c"]);
  });

  it("rejects a slip whose legs are all team-mates", () => {
    const teammates = [
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 80, "OVER", "CIN"),
      cand("c", "Charlie TE", "Bengals", "Buccaneers", 76, "OVER", "CIN"),
    ];
    expect(buildSuggestedSlips(teammates, [2])).toEqual([]);
  });

  it("treats legs from different games as spanning two teams even without ids", () => {
    const twoGames = [
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 80),
      cand("b", "Bravo RB", "Lions", "Saints", 78),
    ];
    expect(buildSuggestedSlips(twoGames, [2])[0].legs).toHaveLength(2);
  });

  it("omits sizes it cannot fill honestly", () => {
    const slips = buildSuggestedSlips(cands, [5, 6]);
    expect(slips).toEqual([]);
    const strict = buildSuggestedSlips(cands, [4], { allowSameGame: false });
    expect(strict).toEqual([]);
  });

  it("attaches pick'em multipliers and a parlay analysis", () => {
    const [two] = buildSuggestedSlips(cands, [2]);
    expect(two.multiplier).toBe(3.5); // two standard 1.87x picks
    expect(two.analysis.legCount).toBe(2);
    expect(two.analysis.combinedHitEstimate).toBeCloseTo(0.8 * 0.78, 5);
  });

  // ---- QB/receiver stacking ----
  //
  // Team-mates are legal on Underdog as long as some leg comes from another
  // team, and a passer stacked with his own receiver is positively correlated
  // (+0.34 measured). Against a multiplier priced as if legs were independent
  // that raises P(all hit) for free, so the builder should reach for it.

  it("detects a QB stacked with his own receiver, and only that", () => {
    const qb = cand("q", "Echo QB", "Chiefs", "Broncos", 70, "OVER", "KC", "Passing Yards");
    const wr = cand("w", "Whiskey WR", "Chiefs", "Broncos", 68, "OVER", "KC", "Receiving Yards");
    expect(stackRho(qb, wr)).toBe(QB_STACK_RHO);
    expect(stackRho(wr, qb)).toBe(QB_STACK_RHO);

    // Opposite directions are not the same bet on the same game script.
    expect(stackRho(qb, { ...wr, direction: "UNDER" })).toBe(0);
    // A receiver on the other team is a different offence entirely.
    expect(stackRho(qb, { ...wr, teamId: "DEN" })).toBe(0);
    // Two receivers sharing a QB measured at +0.003 — not a stack.
    expect(stackRho(wr, { ...wr, pickId: "w2", playerName: "X-ray WR" })).toBe(0);
    // Unknown team means unproven, so no claim is made.
    expect(stackRho(qb, { ...wr, teamId: null })).toBe(0);
  });

  it("prefers a stack partner over a higher-confidence unrelated pick", () => {
    const pool = [
      cand("qb", "Echo QB", "Chiefs", "Broncos", 70, "OVER", "KC", "Passing Yards"),
      cand("far", "Bravo RB", "Lions", "Saints", 69, "OVER", "DET"), // higher conf than the stack partner
      cand("wr", "Whiskey WR", "Chiefs", "Broncos", 60, "OVER", "KC", "Receiving Yards"),
    ];
    const [three] = buildSuggestedSlips(pool, [3]);
    expect(three.legs.map((l) => l.pickId)).toEqual(["qb", "wr", "far"]);

    const good = three.flags.filter((f) => f.tone === "good");
    expect(good).toHaveLength(1);
    expect(good[0].text).toMatch(/same-team stack/);
    expect(correlatedPairsFor(three.legs)).toEqual([{ i: 0, j: 1, rho: QB_STACK_RHO }]);
  });

  it("still refuses a stack that would leave the entry on a single team", () => {
    // QB + his own receiver alone is two legs from one team — rejected by the
    // platform no matter how well correlated it is.
    const oneTeam = [
      cand("qb", "Echo QB", "Chiefs", "Broncos", 70, "OVER", "KC", "Passing Yards"),
      cand("wr", "Whiskey WR", "Chiefs", "Broncos", 68, "OVER", "KC", "Receiving Yards"),
    ];
    expect(buildSuggestedSlips(oneTeam, [2])).toEqual([]);
  });

  // ---- platform availability ----

  it("never suggests a prop confirmed absent from the platform", () => {
    const pool = [
      { ...cand("gone", "Echo QB", "Chiefs", "Broncos", 90, "OVER", "KC", "Passing Yards"), available: false },
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 70, "OVER", "CIN"),
      cand("b", "Bravo RB", "Lions", "Saints", 68, "OVER", "DET"),
    ];
    const [two] = buildSuggestedSlips(pool, [2]);
    // The absent prop outranks both survivors and is still excluded.
    expect(two.legs.map((l) => l.pickId)).toEqual(["a", "b"]);
  });

  it("treats an unchecked prop as playable rather than hiding it on a guess", () => {
    const pool = [
      { ...cand("unknown", "Echo QB", "Chiefs", "Broncos", 90, "OVER", "KC"), available: null },
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 70, "OVER", "CIN"),
    ];
    expect(buildSuggestedSlips(pool, [2])[0].legs.map((l) => l.pickId)).toEqual(["unknown", "a"]);
  });

  // ---- per-pick payouts ----
  // Underdog prices each pick and pays the product. A favourite pays less, so it
  // has to be ranked on probability x payout, not probability.

  it("ranks by value at the actual payout, not raw probability", () => {
    // 65% at 1.55x is worth 1.01; 60% at the standard 1.87x is worth 1.12.
    const pool = [
      { ...cand("fav", "Favourite WR", "Chiefs", "Broncos", 65, "UNDER", "KC"), pickMultiplier: 1.55 },
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 60, "OVER", "CIN"),
      cand("b", "Bravo RB", "Lions", "Saints", 59, "OVER", "DET"),
    ];
    const [two] = buildSuggestedSlips(pool, [2]);
    expect(two.legs.map((l) => l.pickId)).toEqual(["a", "b"]);
  });

  it("leaves out a pick priced too short for its probability", () => {
    // The Kyren Williams leg from 2026-09-27: 55% at 1.55x is worth 0.85.
    const pool = [
      { ...cand("short", "Kyren Williams", "Broncos", "Rams", 55, "UNDER", "LAR"), pickMultiplier: 1.55 },
      cand("a", "Alpha WR", "Bengals", "Buccaneers", 54, "OVER", "CIN"),
      cand("b", "Bravo RB", "Lions", "Saints", 54, "OVER", "DET"),
    ];
    const ids = buildSuggestedSlips(pool, [2])[0].legs.map((l) => l.pickId);
    expect(ids).not.toContain("short");
  });

  it("prices a priced slip from its picks' payouts and says what each needs", () => {
    // The slip actually placed on 2026-09-27. Engram at 56% and 1.78x is worth
    // 0.997 — a hair under break-even — so the builder leaves him out, and the
    // best it can honestly offer is the two legs that clear their price.
    const pool = [
      { ...cand("h", "RJ Harvey", "Broncos", "Rams", 62, "OVER", "DEN"), pickMultiplier: 1.71 },
      { ...cand("e", "Evan Engram", "Broncos", "Rams", 56, "OVER", "DEN"), pickMultiplier: 1.78 },
      { ...cand("p", "Colby Parkinson", "Broncos", "Rams", 56, "OVER", "LAR"), pickMultiplier: 1.87 },
    ];
    expect(buildSuggestedSlips(pool, [3])).toEqual([]);
    const [two] = buildSuggestedSlips(pool, [2]);
    expect(two.legs.map((l) => l.pickId)).toEqual(["h", "p"]);
    expect(two.multiplier).toBeCloseTo(1.71 * 1.87, 6);
    expect(two.baseMultiplier).toBe(3.5);
    const texts = two.flags.map((f) => f.text).join(" ");
    expect(texts).toMatch(/RJ Harvey pays 1.71× — needs 58\.5%, model says 62%/);
    expect(texts).toMatch(/same-game entries/);
  });

  it("leaves an unpriced slip at the standard rung", () => {
    const [two] = buildSuggestedSlips(cands, [2]);
    expect(two.multiplier).toBe(two.baseMultiplier);
    expect(two.flags.some((f) => /pays/.test(f.text))).toBe(false);
  });

  it("is deterministic across calls", () => {
    const a = buildSuggestedSlips(cands).map((s) => s.legs.map((l) => l.pickId));
    const b = buildSuggestedSlips([...cands].reverse()).map((s) => s.legs.map((l) => l.pickId));
    expect(a).toEqual(b);
  });
});

describe("pickToSlipCandidate / whyLineFor", () => {
  const pick = {
    id: "p1",
    confidenceScore: 74,
    riskLevel: "Low",
    reasonsFor: [],
    reasoningSummary: "Over lean at 74/100. Supported by x.",
    evidence: [
      { category: "recentForm", title: "Cleared the over in 8 of last 10", summary: "", confidenceImpact: 9, sourceName: "ESPN gamelog" },
      { category: "matchup", title: "Matchup favors the over", summary: "", confidenceImpact: -3, sourceName: "ESPN box scores" },
    ],
    prop: {
      playerName: "Ja'Marr Chase",
      team: "Cincinnati Bengals",
      opponent: "Tampa Bay Buccaneers",
      date: "2026-09-13",
      propType: "Receiving Yards",
      direction: "OVER",
      line: 82.5,
      underdogLine: 79.5,
      sport: "NFL",
      playerTeamId: "CIN",
    },
  } as unknown as SerializedPick;

  it("uses the entered Underdog line and the strongest evidence when no reason exists", () => {
    const c = pickToSlipCandidate(pick);
    expect(c.line).toBe(79.5);
    expect(c.whyLine).toBe("Cleared the over in 8 of last 10 (ESPN gamelog)");
    expect(c.gameKey).toBe(makeGameKey("Cincinnati Bengals", "Tampa Bay Buccaneers", "2026-09-13"));
  });

  it("prefers the first reason-for when present", () => {
    expect(whyLineFor({ ...pick, reasonsFor: ["Hot recent stretch."] } as SerializedPick)).toBe("Hot recent stretch.");
  });
});
