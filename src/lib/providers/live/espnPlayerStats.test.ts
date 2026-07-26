import { describe, expect, it } from "vitest";
import { parseGamelog, extractStat } from "./espnPlayerStats";

// Minimal WNBA-shaped gamelog fixture (names parallel to stats).
const NAMES = [
  "minutes",
  "points",
  "totalRebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "fieldGoalsMade-fieldGoalsAttempted",
  "fieldGoalPct",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "threePointPct",
];
const row = (pts: string, reb: string, ast: string, threes: string, min = "34") => [
  min,
  pts,
  reb,
  ast,
  "1",
  "2",
  "3",
  "8-14",
  "57.1",
  threes,
  "33.3",
];

const gamelogJson = {
  names: NAMES,
  seasonTypes: [
    {
      displayName: "2026 Preseason",
      categories: [{ events: [{ eventId: "pre1", stats: row("5", "5", "5", "0-1") }] }],
    },
    {
      displayName: "2026 Regular Season",
      categories: [
        {
          events: [
            { eventId: "g_new", stats: row("30", "10", "8", "3-6") },
            { eventId: "g_old", stats: row("20", "6", "4", "1-3") },
            { eventId: "allstar", stats: row("40", "2", "9", "5-8") },
          ],
        },
      ],
    },
  ],
  events: {
    pre1: { gameDate: "2026-05-01T00:00:00Z", homeTeamId: "17", team: { id: "17" }, opponent: { id: "18" } },
    g_new: { gameDate: "2026-07-20T00:00:00Z", homeTeamId: "18", team: { id: "17" }, opponent: { id: "18" } },
    g_old: { gameDate: "2026-07-10T00:00:00Z", homeTeamId: "17", team: { id: "17" }, opponent: { id: "20" } },
    allstar: { gameDate: "2026-07-15T00:00:00Z", team: { id: "99", isAllStar: true }, eventNote: "AT&T WNBA All-Star Game" },
  },
};

describe("parseGamelog", () => {
  const parsed = parseGamelog(gamelogJson);

  it("excludes preseason and All-Star games", () => {
    expect(parsed.rows.map((r) => r.eventId)).toEqual(["g_new", "g_old"]);
  });

  it("orders games most-recent-first", () => {
    expect(parsed.rows[0].eventId).toBe("g_new");
  });

  it("derives home/away from the player's team vs homeTeamId", () => {
    expect(parsed.rows.find((r) => r.eventId === "g_new")?.homeAway).toBe("away"); // team 17, home 18
    expect(parsed.rows.find((r) => r.eventId === "g_old")?.homeAway).toBe("home"); // team 17, home 17
  });
});

describe("extractStat", () => {
  const parsed = parseGamelog(gamelogJson);
  const newest = parsed.rows[0].stats;

  it("reads simple columns via names, not labels", () => {
    expect(extractStat("basketball", "Points", parsed.names, newest)).toBe(30);
    expect(extractStat("basketball", "Rebounds", parsed.names, newest)).toBe(10);
    expect(extractStat("basketball", "Assists", parsed.names, newest)).toBe(8);
  });

  it("sums combo props", () => {
    expect(extractStat("basketball", "Pts+Reb+Ast", parsed.names, newest)).toBe(48);
  });

  it("takes makes from a compound 'made-attempted' cell", () => {
    expect(extractStat("basketball", "3-Pointers Made", parsed.names, newest)).toBe(3);
  });

  it("returns null for an absent column", () => {
    expect(extractStat("hockey", "Saves", parsed.names, newest)).toBeNull();
  });
});
