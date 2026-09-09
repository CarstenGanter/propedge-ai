import { describe, expect, it } from "vitest";
import {
  aggFromArray,
  aggToArray,
  aggregateDefense,
  extractTeamGameLines,
  paceBucket,
  pickDefenseBasis,
  rankDefense,
  type EspnSummaryBox,
  type TeamGameLine,
} from "./defense";

// Verified ESPN summary shape: boxscore.teams[].statistics + players[].statistics.
const summary: EspnSummaryBox = {
  boxscore: {
    teams: [
      {
        team: { displayName: "Tampa Bay Buccaneers" },
        homeAway: "away",
        statistics: [
          { name: "netPassingYards", displayValue: "159" },
          { name: "rushingYards", displayValue: "101" },
          { name: "totalYards", displayValue: "260" },
          { name: "completionAttempts", displayValue: "17/32" },
          { name: "totalOffensivePlays", displayValue: "56" },
        ],
      },
      {
        team: { displayName: "Atlanta Falcons" },
        homeAway: "home",
        statistics: [
          { name: "netPassingYards", displayValue: "289" },
          { name: "rushingYards", displayValue: "69" },
          { name: "totalYards", displayValue: "358" },
          { name: "completionAttempts", displayValue: "27/42" },
          { name: "totalOffensivePlays", displayValue: "71" },
        ],
      },
    ],
    players: [
      {
        team: { displayName: "Tampa Bay Buccaneers" },
        statistics: [
          {
            name: "passing",
            keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns"],
            athletes: [{ stats: ["17/32", "167", "5.2", "3"] }],
          },
        ],
      },
      {
        team: { displayName: "Atlanta Falcons" },
        statistics: [
          {
            name: "passing",
            keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns"],
            athletes: [{ stats: ["27/42", "298", "7.1", "1"] }],
          },
        ],
      },
    ],
  },
};

describe("extractTeamGameLines", () => {
  const lines = extractTeamGameLines(summary, { eventId: "e1", season: 2025, week: 1 });

  it("produces one 'allowed' line per team from the opponent's offense", () => {
    expect(lines).toHaveLength(2);
    const tb = lines.find((l) => l.team === "Tampa Bay Buccaneers")!;
    expect(tb.opponent).toBe("Atlanta Falcons");
    expect(tb.oppNetPassYds).toBe(289);
    expect(tb.oppRushYds).toBe(69);
    expect(tb.oppTotalYds).toBe(358);
    expect(tb.oppCompletions).toBe(27);
    expect(tb.oppPassTds).toBe(1);
    expect(tb.oppPlays).toBe(71);
  });

  it("sums opponent pass TDs from the players box", () => {
    const atl = lines.find((l) => l.team === "Atlanta Falcons")!;
    expect(atl.oppPassTds).toBe(3);
    expect(atl.oppNetPassYds).toBe(159);
  });

  it("returns nothing for a malformed summary", () => {
    expect(extractTeamGameLines({}, { eventId: "x", season: 2025, week: 1 })).toEqual([]);
  });
});

function line(team: string, oppPass: number, oppRush: number, plays: number, eventId = "e"): TeamGameLine {
  return {
    eventId,
    season: 2025,
    week: 1,
    team,
    opponent: "X",
    oppNetPassYds: oppPass,
    oppRushYds: oppRush,
    oppTotalYds: oppPass + oppRush,
    oppCompletions: 20,
    oppPassTds: 1,
    oppPlays: plays,
  };
}

describe("aggregateDefense / rankDefense", () => {
  const lines = [
    line("Alpha", 300, 100, 70, "1"),
    line("Alpha", 200, 120, 60, "2"),
    line("Bravo", 150, 150, 65, "3"),
    line("Charlie", 400, 80, 75, "4"),
  ];
  const agg = aggregateDefense(lines);

  it("averages per game", () => {
    expect(agg.get("alpha")).toMatchObject({ gp: 2, passYdsPg: 250, rushYdsPg: 110, playsFacedPg: 65 });
    expect(agg.get("bravo")).toMatchObject({ gp: 1, passYdsPg: 150 });
  });

  it("ranks fewest-allowed first (rank 1 = toughest)", () => {
    const pass = rankDefense(agg, "passYds");
    expect(pass.get("bravo")?.rank).toBe(1);
    expect(pass.get("alpha")?.rank).toBe(2);
    expect(pass.get("charlie")?.rank).toBe(3);
    const rush = rankDefense(agg, "rush");
    expect(rush.get("charlie")?.rank).toBe(1);
    expect(rush.get("bravo")?.rank).toBe(3);
  });

  it("round-trips through the cache serialization", () => {
    const back = aggFromArray(aggToArray(agg));
    expect(back.get("alpha")?.passYdsPg).toBe(250);
  });
});

describe("paceBucket", () => {
  it("buckets plays faced into tertiles", () => {
    const all = [55, 58, 60, 62, 64, 66, 68, 70, 72];
    expect(paceBucket(72, all)).toBe("fast");
    expect(paceBucket(55, all)).toBe("slow");
    expect(paceBucket(64, all)).toBe("average");
  });
  it("is neutral with too few samples", () => {
    expect(paceBucket(70, [70, 60])).toBe("average");
  });
});

describe("pickDefenseBasis", () => {
  const current = aggregateDefense([line("Alpha", 300, 100, 70, "1"), line("Alpha", 200, 120, 60, "2"), line("Bravo", 150, 150, 65, "3")]);
  const prior = aggregateDefense([
    line("Alpha", 260, 110, 66, "p1"),
    line("Alpha", 240, 100, 64, "p2"),
    line("Alpha", 250, 105, 65, "p3"),
    line("Bravo", 180, 140, 62, "p4"),
  ]);

  it("falls back to the prior season below the minimum current-season games", () => {
    const b = pickDefenseBasis(current, prior, "alpha", "passYds", 3);
    expect(b?.basis).toBe("prior");
    expect(b?.currentGames).toBe(2);
    expect(b?.rank.allowedPg).toBe(250);
  });

  it("uses the current season once enough games exist", () => {
    const b = pickDefenseBasis(current, prior, "alpha", "passYds", 2);
    expect(b?.basis).toBe("current");
    expect(b?.rank.allowedPg).toBe(250);
    expect(b?.agg.gp).toBe(2);
  });

  it("returns null when neither season knows the team", () => {
    expect(pickDefenseBasis(current, prior, "zulu", "passYds")).toBeNull();
    expect(pickDefenseBasis(null, null, "alpha", "passYds")).toBeNull();
  });
});
