import { describe, expect, it } from "vitest";
import { compareRank, onePerPlayer } from "./boardSelection";
import { boardRank, boardTier } from "./pickemMath";

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

describe("compareRank with boardTier/boardRank", () => {
  const base = { reliable: true, priced: true, direction: "OVER" as const, booksLine: 40.5 };
  const pick = (name: string, books: number, payout: number | null, underdogLine = 40.5) => {
    const t = boardTier({ ...base, books, payout, underdogLine });
    return { name, t, key: boardRank(t, books, payout) };
  };

  it("puts playable picks first by expected value, then candidates by edge, then passes", () => {
    const picks = [
      pick("candidate 58%", 0.58, null),
      pick("pass tougher", 0.7, null, 42.5), // a tougher line is never a candidate
      pick("playable 1.05", 0.56, 1.875), // 1.050
      pick("candidate 55%", 0.55, null),
      pick("playable 1.12", 0.6, 1.87), // 1.122
    ];
    const ordered = [...picks].sort((a, b) => compareRank(a.key, b.key)).map((p) => p.name);
    expect(ordered).toEqual(["playable 1.12", "playable 1.05", "candidate 58%", "candidate 55%", "pass tougher"]);
  });
});
