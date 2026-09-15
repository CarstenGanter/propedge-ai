import { describe, expect, it } from "vitest";
import {
  aggregateDefenseVsPosition,
  metricForProp,
  posGroupOf,
  rankDefenseVsPosition,
} from "./defenseByPosition";
import { nflverseCode, NFLVERSE_TEAM_COUNT } from "./teamCodes";
import type { WeeklyStatRow } from "@/lib/providers/live/nflverse";

const row = (over: Partial<WeeklyStatRow>): WeeklyStatRow => ({
  gsisId: "p",
  week: 1,
  team: "OFF",
  opponent: "DEF",
  position: "WR",
  targets: 0,
  targetShare: null,
  airYardsShare: null,
  receptions: 0,
  receivingYards: 0,
  carries: 0,
  rushingYards: 0,
  ...over,
});

describe("posGroupOf", () => {
  it("folds fullbacks in with running backs and ignores non-receivers", () => {
    expect(posGroupOf("WR")).toBe("WR");
    expect(posGroupOf("te")).toBe("TE");
    expect(posGroupOf("RB")).toBe("RB");
    expect(posGroupOf("FB")).toBe("RB");
    expect(posGroupOf("QB")).toBeNull();
    expect(posGroupOf("CB")).toBeNull();
  });
});

describe("aggregateDefenseVsPosition", () => {
  const rows = [
    // Week 1 vs DEF: tight ends feast, receivers do not.
    row({ week: 1, position: "TE", receivingYards: 80, receptions: 6, targets: 8 }),
    row({ week: 1, position: "WR", receivingYards: 30, receptions: 3, targets: 6 }),
    row({ week: 1, position: "RB", rushingYards: 90, receivingYards: 10, receptions: 2 }),
    // Week 2 vs DEF: same pattern.
    row({ week: 2, position: "TE", receivingYards: 90, receptions: 7, targets: 9 }),
    row({ week: 2, position: "WR", receivingYards: 40, receptions: 4, targets: 7 }),
  ];

  it("reports per-game figures using games played, not row counts", () => {
    const agg = aggregateDefenseVsPosition(rows);
    const def = agg.get("DEF")!;
    expect(def.TE!.gp).toBe(2);
    expect(def.TE!.recYdsPg).toBeCloseTo(85, 6); // (80+90)/2
    expect(def.WR!.recYdsPg).toBeCloseTo(35, 6);
    expect(def.RB!.rushYdsPg).toBeCloseTo(45, 6); // 90 over two games
  });

  it("separates what a team allows to each position group", () => {
    const def = aggregateDefenseVsPosition(rows).get("DEF")!;
    expect(def.TE!.recYdsPg).toBeGreaterThan(def.WR!.recYdsPg * 2);
  });

  it("counts a week the defense played even if only non-skill players recorded stats", () => {
    const agg = aggregateDefenseVsPosition([
      ...rows,
      row({ week: 3, position: "QB", receivingYards: 0 }),
    ]);
    expect(agg.get("DEF")!.TE!.gp).toBe(3); // three games, TE yardage unchanged
    expect(agg.get("DEF")!.TE!.recYdsPg).toBeCloseTo(56.7, 1); // 170/3, rounded to 0.1
  });

  it("ignores rows without an opponent", () => {
    expect(aggregateDefenseVsPosition([row({ opponent: "" })]).size).toBe(0);
  });
});

describe("rankDefenseVsPosition", () => {
  const agg = aggregateDefenseVsPosition([
    row({ opponent: "TOUGH", position: "TE", receivingYards: 20 }),
    row({ opponent: "MID", position: "TE", receivingYards: 60 }),
    row({ opponent: "SOFT", position: "TE", receivingYards: 100 }),
  ]);

  it("ranks fewest allowed as rank 1", () => {
    const r = rankDefenseVsPosition(agg, "TE", "recYdsPg");
    expect(r.get("TOUGH")!.rank).toBe(1);
    expect(r.get("SOFT")!.rank).toBe(3);
    expect(r.get("MID")!.leagueSize).toBe(3);
  });

  it("omits teams with no data for that position", () => {
    expect(rankDefenseVsPosition(agg, "WR", "recYdsPg").size).toBe(0);
  });
});

describe("metricForProp", () => {
  it("routes each prop to the stat its position is measured by", () => {
    expect(metricForProp("Receiving Yards")).toBe("recYdsPg");
    expect(metricForProp("Receptions")).toBe("recPg");
    expect(metricForProp("Rushing Yards")).toBe("rushYdsPg");
    expect(metricForProp("Passing Yards")).toBeNull(); // team-level view handles these
    expect(metricForProp("Pass TDs")).toBeNull();
  });
});

describe("nflverseCode", () => {
  it("covers all 32 teams", () => {
    expect(NFLVERSE_TEAM_COUNT).toBe(32);
  });

  it("maps the two codes that differ from ESPN", () => {
    expect(nflverseCode("Los Angeles Rams")).toBe("LA");
    expect(nflverseCode("Washington Commanders")).toBe("WAS");
  });

  it("matches however the books spell a team", () => {
    expect(nflverseCode("Kansas City Chiefs")).toBe("KC");
    expect(nflverseCode("Chiefs")).toBe("KC");
    expect(nflverseCode("49ers")).toBe("SF");
    expect(nflverseCode("Not A Team")).toBeNull();
  });
});
