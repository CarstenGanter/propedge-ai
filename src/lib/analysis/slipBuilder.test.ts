import { describe, expect, it } from "vitest";
import { buildSuggestedSlips, pickToSlipCandidate, whyLineFor, type SlipCandidate } from "./slipBuilder";
import type { SerializedPick } from "@/lib/dto";
import { makeGameKey } from "./parlayCorrelation";

function cand(
  id: string,
  player: string,
  team: string,
  opp: string,
  conf: number,
  direction: "OVER" | "UNDER" = "OVER",
): SlipCandidate {
  return {
    pickId: id,
    playerName: player,
    team,
    opponent: opp,
    gameKey: makeGameKey(team, opp, "2026-09-13"),
    propType: "Receiving Yards",
    direction,
    confidenceScore: conf,
    riskLevel: "Medium",
    line: 60.5,
    sport: "NFL",
    date: "2026-09-13",
    whyLine: "why",
  };
}

describe("buildSuggestedSlips", () => {
  const cands = [
    cand("a", "Alpha WR", "Bengals", "Buccaneers", 80),
    cand("b", "Bravo RB", "Lions", "Saints", 78),
    cand("c", "Charlie TE", "Bengals", "Buccaneers", 76), // same game as a
    cand("d", "Alpha WR", "Bengals", "Buccaneers", 75), // same player as a (other prop)
    cand("e", "Echo QB", "Chiefs", "Broncos", 72),
    cand("f", "Foxtrot WR", "Lions", "Saints", 70, "UNDER"), // same game as b, opposite direction
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
    expect(four.flags[0]).toMatch(/Charlie TE shares a game/);
  });

  it("omits sizes it cannot fill honestly", () => {
    const slips = buildSuggestedSlips(cands, [5, 6]);
    expect(slips).toEqual([]);
    const strict = buildSuggestedSlips(cands, [4], { allowSameGame: false });
    expect(strict).toEqual([]);
  });

  it("attaches pick'em multipliers and a parlay analysis", () => {
    const [two] = buildSuggestedSlips(cands, [2]);
    expect(two.multiplier).toBe(3);
    expect(two.analysis.legCount).toBe(2);
    expect(two.analysis.combinedHitEstimate).toBeCloseTo(0.8 * 0.78, 5);
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
