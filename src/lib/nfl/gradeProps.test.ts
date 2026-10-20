import { describe, expect, it } from "vitest";
import { gradeProp, parseGradingStats, priorGames, statValue, weekForGame, type SeasonData, type StatRow } from "./gradeProps";

const row = (o: Partial<StatRow>): StatRow => ({
  gsisId: "x",
  name: "X",
  week: 1,
  team: "DEN",
  opponent: "SEA",
  receptions: 0,
  receivingYards: 0,
  rushingYards: 0,
  carries: 0,
  passingYards: 0,
  passingTds: 0,
  completions: 0,
  attempts: 0,
  ...o,
});

// Week 6, 2026-10-15: Seattle at Denver.
const season: SeasonData = {
  rows: [
    row({ gsisId: "horton", name: "Tory Horton", week: 6, team: "SEA", opponent: "DEN", receptions: 1, receivingYards: 13 }),
    row({ gsisId: "nix", name: "Bo Nix", week: 6, team: "DEN", opponent: "SEA", passingYards: 188, passingTds: 1, completions: 19, attempts: 30 }),
    row({ gsisId: "horton", name: "Tory Horton", week: 3, team: "SEA", opponent: "WAS", receptions: 3, receivingYards: 48 }),
    row({ gsisId: "other", name: "Lil'Jordan Humphrey", week: 6, team: "NYG", opponent: "PHI", receivingYards: 40 }),
  ],
  appearances: [
    { gsisId: "humphrey", name: "Lil'Jordan Humphrey", week: 6, team: "DEN" },
    { gsisId: "horton", name: "Tory Horton", week: 4, team: "SEA" },
  ],
};

describe("parseGradingStats", () => {
  it("reads nflverse columns and skips the preseason", () => {
    const csv =
      "player_id,player_display_name,week,season_type,team,opponent_team,receptions,receiving_yards,rushing_yards,carries,passing_yards,passing_tds,completions,attempts\n" +
      "00-1,Tory Horton,6,REG,SEA,DEN,1,13,NA,,0,0,0,0\n" +
      "00-2,Someone,1,PRE,SEA,DEN,5,50,0,0,0,0,0,0\n";
    const rows = parseGradingStats(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gsisId: "00-1", name: "Tory Horton", week: 6, receivingYards: 13, rushingYards: 0 });
  });
});

describe("statValue", () => {
  it("adds rushing and receiving for Rush+Rec", () => {
    expect(statValue(row({ rushingYards: 30, receivingYards: 12 }), "Rush+Rec Yards")).toBe(42);
  });
  it("has no value for a prop nflverse can't grade", () => {
    expect(statValue(row({}), "Points")).toBeNull();
  });
});

describe("gradeProp", () => {
  it("finds the game week from home and away", () => {
    expect(weekForGame(season.rows, "DEN", "SEA")).toBe(6);
    expect(weekForGame(season.rows, "SEA", "DEN")).toBe(6);
    expect(weekForGame(season.rows, "KC", "LV")).toBeNull();
  });

  it("grades from the stat line", () => {
    expect(gradeProp({ playerName: "Tory Horton", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season)).toEqual({
      kind: "graded",
      value: 13,
      gsisId: "horton",
      week: 6,
      fromSnapsOnly: false,
    });
  });

  it("grades a player who played but recorded nothing as 0 — the Humphrey case", () => {
    expect(gradeProp({ playerName: "Lil'Jordan Humphrey", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season)).toMatchObject({
      kind: "graded",
      value: 0,
      gsisId: "humphrey",
      fromSnapsOnly: true,
    });
  });

  it("only matches players on the two teams in the game", () => {
    // A same-named player on the Giants never grades this prop.
    const g = gradeProp({ playerName: "Lil'Jordan Humphrey", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season);
    expect(g.kind === "graded" && g.gsisId).toBe("humphrey");
  });

  it("voids a player who only played special teams — never 0", () => {
    const withSt: SeasonData = { ...season, specialTeamsOnly: [{ gsisId: "gunner", name: "Special Teamer", week: 6, team: "SEA" }] };
    expect(gradeProp({ playerName: "Special Teamer", propType: "Receptions", home: "DEN", away: "SEA" }, withSt)).toEqual({
      kind: "void",
      gsisId: "gunner",
      week: 6,
      reason: "special teams only",
    });
  });

  it("matches through a generational suffix", () => {
    const withJr: SeasonData = {
      ...season,
      rows: [...season.rows, row({ gsisId: "etienne", name: "Travis Etienne", week: 6, team: "DEN", opponent: "SEA", rushingYards: 71 })],
    };
    expect(gradeProp({ playerName: "Travis Etienne Jr.", propType: "Rushing Yards", home: "DEN", away: "SEA" }, withJr)).toMatchObject({
      kind: "graded",
      value: 71,
    });
  });

  it("voids a rostered player with no snap and no stat — he did not play", () => {
    const withRoster: SeasonData = { ...season, roster: [{ gsisId: "inactive", name: "Jordan Addison", team: "SEA" }] };
    expect(gradeProp({ playerName: "Jordan Addison", propType: "Receptions", home: "DEN", away: "SEA" }, withRoster)).toEqual({
      kind: "void",
      gsisId: "inactive",
      week: 6,
      reason: "did not play",
    });
  });

  it("is unmatched when nobody on either team has the name", () => {
    expect(gradeProp({ playerName: "Nobody Here", propType: "Receptions", home: "DEN", away: "SEA" }, season).kind).toBe("unmatched");
  });

  it("is pending when the game is not in the data yet", () => {
    expect(gradeProp({ playerName: "Tory Horton", propType: "Receptions", home: "SF", away: "WAS" }, season)).toEqual({ kind: "pending" });
  });
});

describe("priorGames", () => {
  it("uses only weeks before the game, most recent first, with snap-only games as 0", () => {
    expect(priorGames("horton", "Receiving Yards", 6, season, null)).toEqual([0, 48]);
  });

  it("tops up from last season only when fewer than 4 current games", () => {
    const prior: SeasonData = {
      rows: [10, 11, 12, 13, 14, 15, 16, 17].map((w) => row({ gsisId: "horton", week: w, team: "SEA", receivingYards: w })),
      appearances: [],
    };
    expect(priorGames("horton", "Receiving Yards", 6, season, prior)).toEqual([0, 48, 17, 16, 15, 14, 13, 12, 11, 10]);
    const four: SeasonData = {
      rows: [1, 2, 3, 4].map((w) => row({ gsisId: "horton", week: w, team: "SEA", receivingYards: w * 10 })),
      appearances: [],
    };
    expect(priorGames("horton", "Receiving Yards", 6, four, prior)).toEqual([40, 30, 20, 10]);
  });

  it("caps at the 15 most recent", () => {
    const many: SeasonData = {
      rows: Array.from({ length: 18 }, (_, i) => row({ gsisId: "p", week: i + 1, team: "SEA", receptions: i + 1 })),
      appearances: [],
    };
    const g = priorGames("p", "Receptions", 19, many, null);
    expect(g).toHaveLength(15);
    expect(g[0]).toBe(18);
  });
});
