import { describe, expect, it } from "vitest";
import { gradeProp, parseGradingStats, parseSchedule, parseWeeklyRoster, priorGames, statValue, weekForGame, weekForScheduledGame, type RosterEntry, type ScheduledGame, type SeasonData, type StatRow } from "./gradeProps";

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

describe("parseWeeklyRoster", () => {
  it("reads ids, team, status and the football name", () => {
    const csv =
      "season,team,position,status,full_name,football_name,last_name,gsis_id,espn_id,week\n" +
      "2026,BUF,WR,INA,Denniston Moore,D.J.,Moore,00-0034827,3915416,6\n";
    expect(parseWeeklyRoster(csv)).toEqual([
      { gsisId: "00-0034827", espnId: "3915416", week: 6, team: "BUF", status: "INA", position: "WR", name: "Denniston Moore", altName: "D.J. Moore" },
    ]);
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
      matchedBy: "name",
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
      matchedBy: "name",
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

  const entry = (o: Partial<RosterEntry>): RosterEntry => ({ gsisId: "g", espnId: null, week: 6, team: "SEA", status: "ACT", name: "N", ...o });

  it("voids a rostered player with no snap and no stat — he did not play", () => {
    const withRoster: SeasonData = { ...season, roster: [entry({ gsisId: "inactive", name: "Jordan Addison", status: "INA" })] };
    expect(gradeProp({ playerName: "Jordan Addison", propType: "Receptions", home: "DEN", away: "SEA" }, withRoster)).toEqual({
      kind: "void",
      gsisId: "inactive",
      week: 6,
      reason: "did not play (roster status INA)",
      matchedBy: "name",
    });
  });

  it("matches by ESPN id whatever the spelling — the Ogletree case", () => {
    const s: SeasonData = {
      rows: [...season.rows, row({ gsisId: "ogletree", name: "Andrew Ogletree", week: 6, team: "DEN", opponent: "SEA", receptions: 3 })],
      appearances: season.appearances,
      roster: [entry({ gsisId: "ogletree", espnId: "4722908", team: "DEN", name: "Andrew Ogletree" })],
    };
    expect(gradeProp({ playerName: "Drew Ogletree", espnId: "4722908", propType: "Receptions", home: "DEN", away: "SEA" }, s)).toMatchObject({
      kind: "graded",
      value: 3,
      matchedBy: "id",
    });
    // Without the id, the spelling difference leaves it unmatched.
    expect(gradeProp({ playerName: "Drew Ogletree", propType: "Receptions", home: "DEN", away: "SEA" }, s).kind).toBe("unmatched");
  });

  it("resolves two players of one name to the one who played — the DeVonta Smith case", () => {
    const s: SeasonData = {
      rows: [...season.rows, row({ gsisId: "phi-smith", name: "DeVonta Smith", week: 6, team: "DEN", opponent: "SEA", receptions: 6 })],
      appearances: season.appearances,
      roster: [
        entry({ gsisId: "phi-smith", team: "DEN", name: "DeVonta Smith" }),
        entry({ gsisId: "ps-smith", team: "SEA", name: "Devonta Smith", status: "DEV" }),
      ],
    };
    expect(gradeProp({ playerName: "DeVonta Smith", propType: "Receptions", home: "DEN", away: "SEA" }, s)).toMatchObject({
      kind: "graded",
      gsisId: "phi-smith",
      value: 6,
    });
  });

  it("grades a traded player against the team he was on that week", () => {
    const s: SeasonData = {
      rows: [
        ...season.rows,
        row({ gsisId: "mover", name: "Moved Guy", week: 5, team: "NYG", opponent: "PHI", receivingYards: 10 }),
        row({ gsisId: "mover", name: "Moved Guy", week: 6, team: "DEN", opponent: "SEA", receivingYards: 55 }),
        row({ gsisId: "x2", name: "Giants Player", week: 6, team: "NYG", opponent: "DAL" }),
      ],
      appearances: [],
      roster: [
        entry({ gsisId: "mover", espnId: "e1", week: 5, team: "NYG", name: "Moved Guy" }),
        entry({ gsisId: "mover", espnId: "e1", week: 6, team: "DEN", name: "Moved Guy" }),
      ],
    };
    expect(gradeProp({ playerName: "Moved Guy", espnId: "e1", propType: "Receiving Yards", home: "DEN", away: "SEA" }, s)).toMatchObject({
      kind: "graded",
      value: 55,
    });
    // A week-6 prop that put him with the Giants contradicts the roster.
    expect(gradeProp({ playerName: "Moved Guy", espnId: "e1", propType: "Receiving Yards", home: "NYG", away: "DAL" }, s)).toEqual({
      kind: "unmatched",
      week: 6,
      reason: "id is on DEN that week",
    });
  });

  it("is unmatched when nobody on either team has the name", () => {
    expect(gradeProp({ playerName: "Nobody Here", propType: "Receptions", home: "DEN", away: "SEA" }, season).kind).toBe("unmatched");
  });

  it("tries an unmatched name's alias before declaring it unmatched", () => {
    const alias = (n: string) => (n === "Feed Label" ? "Tory Horton" : null);
    expect(gradeProp({ playerName: "Feed Label", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season, { alias })).toEqual({
      kind: "graded",
      value: 13,
      gsisId: "horton",
      week: 6,
      fromSnapsOnly: false,
      matchedBy: "alias",
    });
    expect(gradeProp({ playerName: "Feed Label", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season).kind).toBe("unmatched");
  });

  it("never lets an alias override a name that matches someone", () => {
    const alias = () => "Lil'Jordan Humphrey";
    expect(gradeProp({ playerName: "Tory Horton", propType: "Receiving Yards", home: "DEN", away: "SEA" }, season, { alias })).toMatchObject({ gsisId: "horton", matchedBy: "name" });
  });

  it("stays unmatched when the alias isn't in the game either", () => {
    expect(gradeProp({ playerName: "Feed Label", propType: "Receptions", home: "DEN", away: "SEA" }, season, { alias: () => "Nobody Here" }).kind).toBe("unmatched");
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

describe("division rematches", () => {
  // Seattle at Denver in week 6 (2026-10-15), Denver at Seattle in week 15 (2026-12-20).
  const schedule: ScheduledGame[] = [
    { week: 6, gameday: "2026-10-15", home: "DEN", away: "SEA", espnGameId: "401872995" },
    { week: 15, gameday: "2026-12-20", home: "SEA", away: "DEN", espnGameId: "401873100" },
  ];
  const rematch: SeasonData = {
    rows: [
      row({ gsisId: "sutton", name: "Courtland Sutton", week: 6, team: "DEN", opponent: "SEA", receivingYards: 88 }),
      row({ gsisId: "sutton", name: "Courtland Sutton", week: 15, team: "DEN", opponent: "SEA", receivingYards: 21 }),
    ],
    appearances: [
      { gsisId: "humphrey", name: "Lil'Jordan Humphrey", week: 6, team: "DEN" },
      { gsisId: "sutton", name: "Courtland Sutton", week: 6, team: "DEN" },
      { gsisId: "sutton", name: "Courtland Sutton", week: 15, team: "DEN" },
    ],
    schedule,
  };
  // Odds API props store the home side as `team`: week 15's home team is Seattle.
  const week15 = { propType: "Receiving Yards", home: "SEA", away: "DEN", date: "2026-12-20" };

  it("grades the second meeting from its own week, by ESPN game id or by date", () => {
    expect(gradeProp({ ...week15, playerName: "Courtland Sutton", espnGameId: "401873100" }, rematch)).toMatchObject({ kind: "graded", value: 21, week: 15 });
    expect(gradeProp({ ...week15, playerName: "Courtland Sutton" }, rematch)).toMatchObject({ kind: "graded", value: 21, week: 15 });
    expect(gradeProp({ ...week15, playerName: "Courtland Sutton", home: "DEN", away: "SEA", date: "2026-10-15" }, rematch)).toMatchObject({ value: 88, week: 6 });
  });

  it("never borrows the first meeting's snaps: no week-15 snap row is not a week-6 zero", () => {
    // Humphrey played offense in week 6 and has no week-15 row: void, not "graded 0 from week 6".
    expect(gradeProp({ ...week15, playerName: "Lil'Jordan Humphrey" }, { ...rematch, roster: [{ gsisId: "humphrey", espnId: null, week: 15, team: "DEN", status: "INA", name: "Lil'Jordan Humphrey" }] })).toMatchObject({ kind: "void", week: 15 });
  });

  it("is pending until nflverse posts the second meeting, even though the first is posted", () => {
    const beforeWeek15 = { ...rematch, rows: rematch.rows.filter((r) => r.week === 6), appearances: rematch.appearances.filter((a) => a.week === 6) };
    expect(gradeProp({ ...week15, playerName: "Courtland Sutton" }, beforeWeek15)).toEqual({ kind: "pending" });
  });

  it("refuses to guess without the schedule", () => {
    const { schedule: _s, ...noSchedule } = rematch;
    void _s;
    expect(gradeProp({ ...week15, playerName: "Courtland Sutton" }, noSchedule)).toMatchObject({ kind: "unmatched", reason: expect.stringContaining("weeks 6 and 15") });
    expect(weekForGame(noSchedule.rows, "SEA", "DEN")).toBeNull();
  });

  it("finds the week by ESPN id, else teams within a day of the slate date (either side at home)", () => {
    expect(weekForScheduledGame(schedule, { home: "SEA", away: "DEN", espnGameId: "401873100" })).toBe(15);
    expect(weekForScheduledGame(schedule, { home: "DEN", away: "SEA", date: "2026-12-21" })).toBe(15);
    expect(weekForScheduledGame(schedule, { home: "DEN", away: "SEA", date: "2026-11-01" })).toBeNull();
  });

  it("reads the nflverse schedule for one season", () => {
    const csv =
      "game_id,season,game_type,week,gameday,away_team,home_team,espn\n" +
      "2026_06_SEA_DEN,2026,REG,6,2026-10-15,SEA,DEN,401872995\n" +
      "2025_06_SEA_DEN,2025,REG,6,2025-10-16,SEA,DEN,401700000\n";
    expect(parseSchedule(csv, 2026)).toEqual([{ week: 6, gameday: "2026-10-15", home: "DEN", away: "SEA", espnGameId: "401872995" }]);
  });
});
