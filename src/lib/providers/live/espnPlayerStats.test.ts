import { describe, expect, it } from "vitest";
import { parseGamelog, extractStat, blendGamelogs, type ParsedGamelog } from "./espnPlayerStats";

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

describe("football extractors", () => {
  // Verified NFL gamelog column names (a RB/WR log carries both rushing and receiving columns).
  const names = ["rushingAttempts", "rushingYards", "receptions", "receivingYards", "receivingTargets"];
  const qbNames = ["completions", "passingAttempts", "passingYards", "passingTouchdowns", "rushingAttempts", "rushingYards"];

  it("sums rush + rec yards and volume", () => {
    expect(extractStat("football", "Rush+Rec Yards", names, ["14", "62", "3", "21", "4"])).toBe(83);
    expect(extractStat("football", "Rush Attempts", names, ["14", "62", "3", "21", "4"])).toBe(14);
  });
  it("treats a missing receiving column as 0 for a pure rusher, but null when both are absent", () => {
    expect(extractStat("football", "Rush+Rec Yards", ["rushingYards"], ["55"])).toBe(55);
    expect(extractStat("football", "Rush+Rec Yards", qbNames.slice(0, 4), ["20", "30", "250", "2"])).toBeNull();
  });
  it("reads QB attempts", () => {
    expect(extractStat("football", "Pass Attempts", qbNames, ["24", "35", "281", "2", "3", "12"])).toBe(35);
    expect(extractStat("football", "Completions", qbNames, ["24", "35", "281", "2", "3", "12"])).toBe(24);
  });
});

describe("blendGamelogs (NFL early season)", () => {
  const names = ["receptions", "receivingYards"];
  const row = (eventId: string, date: string, rec: string, yds: string) => ({
    eventId,
    date,
    homeAway: "home" as const,
    opponentTeamId: null,
    stats: [rec, yds],
  });
  const start = "2026-08-01";

  it("returns only current-season rows once the sample is big enough", () => {
    const current: ParsedGamelog = {
      names,
      rows: [row("c4", "2026-10-04T17:00Z", "5", "60"), row("c3", "2026-09-27T17:00Z", "4", "50"), row("c2", "2026-09-20T17:00Z", "6", "70"), row("c1", "2026-09-13T17:00Z", "3", "40"), row("p1", "2026-01-04T18:00Z", "9", "120")],
    };
    const b = blendGamelogs(current, null, start);
    expect(b.blended).toBe(false);
    expect(b.currentGames).toBe(4);
    expect(b.parsed.rows.map((r) => r.eventId)).toEqual(["c4", "c3", "c2", "c1"]);
  });

  it("appends prior-season rows after current ones, most recent first, when the sample is thin", () => {
    const current: ParsedGamelog = { names, rows: [row("c1", "2026-09-13T17:00Z", "3", "40")] };
    const prior: ParsedGamelog = {
      names,
      rows: [row("p2", "2026-01-04T18:00Z", "9", "120"), row("p1", "2025-12-28T18:00Z", "7", "90")],
    };
    const b = blendGamelogs(current, prior, start);
    expect(b.blended).toBe(true);
    expect(b.currentGames).toBe(1);
    expect(b.priorGamesUsed).toBe(2);
    expect(b.parsed.rows.map((r) => r.eventId)).toEqual(["c1", "p2", "p1"]);
  });

  it("uses prior rows already present in the default log without a second fetch", () => {
    const current: ParsedGamelog = { names, rows: [row("p2", "2026-01-04T18:00Z", "9", "120"), row("p1", "2025-12-28T18:00Z", "7", "90")] };
    const b = blendGamelogs(current, null, start);
    expect(b.currentGames).toBe(0);
    expect(b.priorGamesUsed).toBe(2);
    expect(b.blended).toBe(true);
  });

  it("re-aligns prior-season columns to the current column order and caps the sample", () => {
    const current: ParsedGamelog = { names, rows: [row("c1", "2026-09-13T17:00Z", "3", "40")] };
    const prior: ParsedGamelog = {
      names: ["receivingYards", "receptions"], // swapped
      rows: Array.from({ length: 20 }, (_, i) => ({
        eventId: `p${i}`,
        date: `2025-${String(12 - Math.floor(i / 4)).padStart(2, "0")}-${String(28 - (i % 4) * 7).padStart(2, "0")}T18:00Z`,
        homeAway: "away" as const,
        opponentTeamId: null,
        stats: ["100", "8"],
      })),
    };
    const b = blendGamelogs(current, prior, start, 4, 17);
    expect(b.parsed.rows).toHaveLength(17);
    expect(b.parsed.names).toEqual(names);
    expect(extractStat("football", "Receptions", b.parsed.names, b.parsed.rows[1].stats)).toBe(8);
    expect(extractStat("football", "Receiving Yards", b.parsed.names, b.parsed.rows[1].stats)).toBe(100);
  });
});
