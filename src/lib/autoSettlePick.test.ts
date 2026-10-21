import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledGame, SeasonData, StatRow } from "@/lib/nfl/gradeProps";

const settledCalls: { id: string; opts: Record<string, unknown> }[] = [];
const cache = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/generate", () => ({ propToScorable: (p: unknown) => p }));
vi.mock("@/lib/providers", () => ({
  settlementContext: () => ({ demo: false, enableWebResearch: true }),
  usableResult: (_p: unknown, r: { resolved: boolean }) => r.resolved,
  lookupResult: async () => ({ actualResult: null, source: "ESPN", resolved: false, absentFromBoxScore: true, note: "not in the box score" }),
}));
vi.mock("@/lib/settle", () => ({ settlePickById: async (id: string, opts: Record<string, unknown>) => void settledCalls.push({ id, opts }) }));
vi.mock("@/lib/providerCache", () => ({
  cacheGet: async (k: string) => (cache.has(k) ? { value: cache.get(k) } : null),
  cacheSet: async (k: string, v: string) => void cache.set(k, v),
}));

// Week 6, Seattle at Denver: Humphrey took offensive snaps and recorded nothing.
const statRow: StatRow = { gsisId: "00-sutton", name: "Courtland Sutton", week: 6, team: "DEN", opponent: "SEA", receptions: 3, receivingYards: 40, rushingYards: 0, carries: 0, passingYards: 0, passingTds: 0, completions: 0, attempts: 0 };
const schedule: ScheduledGame[] = [{ week: 6, gameday: "2026-10-15", home: "DEN", away: "SEA", espnGameId: "401872995" }];
const season: SeasonData = {
  rows: [statRow],
  appearances: [{ gsisId: "00-humphrey", name: "Lil'Jordan Humphrey", week: 6, team: "DEN" }, { gsisId: "00-sutton", name: "Courtland Sutton", week: 6, team: "DEN" }],
  roster: [{ gsisId: "00-humphrey", espnId: "2", week: 6, team: "DEN", status: "ACT", name: "Lil'Jordan Humphrey" }],
  schedule,
};
vi.mock("@/lib/nfl/nflverseSeasons", () => ({
  loadSeasonStats: async () => season.rows,
  loadSchedule: async () => schedule,
  loadPfrToGsis: async () => new Map(),
  loadSeason: async () => season,
}));

const { createSettler } = await import("./autoSettlePick");
const pick = (playerName: string, espnAthleteId: string | null) =>
  ({
    id: `pick-${playerName}`,
    isDemo: false,
    playerProp: { sport: "NFL", playerName, espnAthleteId, propType: "Receiving Yards", team: "Denver Broncos", opponent: "Seattle Seahawks", date: "2026-10-15", gameId: "401872995" },
  }) as never;

describe("createSettler", () => {
  beforeEach(() => {
    settledCalls.splice(0);
    cache.clear();
  });

  it("grades an NFL player missing from the box score from nflverse snap counts, appending the note", async () => {
    const outcome = await createSettler({ enableWebResearch: true }).settle(pick("Lil'Jordan Humphrey", "2"));
    expect(outcome).toEqual({ kind: "settled", via: "snap-counts" });
    expect(settledCalls[0].opts).toMatchObject({ actualResult: 0, appendNote: expect.stringContaining("nflverse snap counts") });
  });

  it("leaves a player nflverse can't find for the Results page, and remembers that", async () => {
    const settler = createSettler({ enableWebResearch: true });
    const first = await settler.settle(pick("Nobody Here", null));
    expect(first.kind).toBe("unresolved");
    expect(settledCalls).toEqual([]);
    expect([...cache.keys()]).toEqual(["settle:snaps-manual:pick-Nobody Here"]);
    expect((await settler.settle(pick("Nobody Here", null))).kind).toBe("unresolved");
  });
});
