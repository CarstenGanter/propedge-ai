import type { MatchupContext } from "@/types";
import { mlbFetch, mlbSeason, resolvePlayerTeamId } from "./mlbStats";
import { getMlbSchedule } from "./mlbSchedule";

/**
 * MLB opponent matchup via the free MLB Stats API:
 *  - batter props → opposing team's PITCHING rank (soft pitching favors the over)
 *  - pitcher strikeout props → opponent lineup's STRIKEOUT rank (whiff-prone lineup favors the over)
 * Ranks are 1..30 where 1 = toughest for the over. Defensive: undefined on any miss.
 */

const LEAGUE_SIZE = 30;
const TTL = 30 * 60 * 1000;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ---- specific probable starter quality (cached per pitcher) ----

interface PitcherQuality {
  era: number | null;
  whip: number | null;
  avg: number | null;
}
const pitcherCache = new Map<number, { at: number; q: PitcherQuality | null }>();

async function getPitcherQuality(pitcherId: number, season: number): Promise<PitcherQuality | null> {
  const cached = pitcherCache.get(pitcherId);
  if (cached && Date.now() - cached.at < TTL) return cached.q;

  const data = await mlbFetch<{ stats?: { splits?: { stat?: Record<string, unknown> }[] }[] }>(
    `/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`,
  );
  const stat = data?.stats?.[0]?.splits?.[0]?.stat;
  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const q: PitcherQuality | null = stat
    ? { era: numOrNull(stat.era), whip: numOrNull(stat.whip), avg: numOrNull(stat.avg) }
    : null;
  pitcherCache.set(pitcherId, { at: Date.now(), q: q && (q.era != null || q.whip != null) ? q : null });
  return pitcherCache.get(pitcherId)!.q;
}

/**
 * Rank a specific starter's hittability 1..30 (1 = toughest for the over) from
 * ERA + WHIP against league benchmarks. Returns null if stats are unavailable.
 */
function starterMatchup(q: PitcherQuality, name: string | null): MatchupContext | null {
  const norms: number[] = [];
  if (q.era != null) norms.push(clamp01((q.era - 2.8) / (5.2 - 2.8)));
  if (q.whip != null) norms.push(clamp01((q.whip - 1.0) / (1.6 - 1.0)));
  if (norms.length === 0) return null;
  const softness = norms.reduce((a, b) => a + b, 0) / norms.length;
  const rank = Math.round(1 + softness * (LEAGUE_SIZE - 1));
  const bits = [
    q.era != null ? `${q.era.toFixed(2)} ERA` : null,
    q.whip != null ? `${q.whip.toFixed(2)} WHIP` : null,
  ].filter(Boolean);
  return {
    opponentDefenseRank: rank,
    leagueSize: LEAGUE_SIZE,
    opponentContext: `vs SP ${name ?? "TBD"}${bits.length ? ` (${bits.join(", ")})` : ""}`,
    source: "MLB Stats API",
  };
}

interface TeamStatSplit {
  team?: { id?: number };
  stat?: { era?: unknown; strikeOuts?: unknown };
}
interface TeamStatsResp {
  stats?: { splits?: TeamStatSplit[] }[];
}

// teamId -> rank (1 = toughest for the OVER), cached per season+metric.
const rankCache = new Map<string, { at: number; ranks: Map<number, number> }>();

async function getTeamRanks(
  group: "pitching" | "hitting",
  metric: "era" | "strikeOuts",
  ascendingIsTough: boolean,
  season: number,
): Promise<Map<number, number> | null> {
  const key = `${group}|${metric}|${season}`;
  const cached = rankCache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.ranks;

  const data = await mlbFetch<TeamStatsResp>(
    `/teams/stats?stats=season&group=${group}&season=${season}&sportIds=1`,
  );
  const splits = data?.stats?.[0]?.splits ?? [];
  const rows = splits
    .map((s) => ({ id: s.team?.id, val: Number(s.stat?.[metric]) }))
    .filter((r): r is { id: number; val: number } => r.id != null && Number.isFinite(r.val));
  if (rows.length === 0) return null;

  // Sort so index 0 is the "toughest for the over".
  rows.sort((a, b) => (ascendingIsTough ? a.val - b.val : b.val - a.val));
  const ranks = new Map<number, number>();
  rows.forEach((r, i) => ranks.set(r.id, i + 1));
  rankCache.set(key, { at: Date.now(), ranks });
  return ranks;
}

export async function getMlbMatchup(
  playerName: string,
  propType: string,
  date: string,
): Promise<MatchupContext | undefined> {
  const season = mlbSeason();
  const teamId = await resolvePlayerTeamId(playerName);
  if (teamId == null) return undefined;

  const schedule = await getMlbSchedule(date);
  const opponentId = schedule.get(teamId)?.opponentId;
  if (opponentId == null) return undefined;

  const isPitcherProp = propType === "Strikeouts";

  // Batter prop: prefer the SPECIFIC opposing probable starter; fall back to the
  // opposing staff's ERA rank when a starter isn't posted yet.
  if (!isPitcherProp) {
    const spId = schedule.get(opponentId)?.probablePitcherId;
    const spName = schedule.get(opponentId)?.probablePitcher ?? null;
    if (spId != null) {
      const q = await getPitcherQuality(spId, season);
      if (q) {
        const m = starterMatchup(q, spName);
        if (m) return m;
      }
    }
    const teamRanks = await getTeamRanks("pitching", "era", true, season);
    const rank = teamRanks?.get(opponentId);
    return rank == null
      ? undefined
      : { opponentDefenseRank: rank, leagueSize: LEAGUE_SIZE, source: "MLB Stats API" };
  }

  // Pitcher K prop: rank opponent lineups by how MUCH they strike out (more Ks = softer).
  const ranks = await getTeamRanks("hitting", "strikeOuts", true, season);
  const rank = ranks?.get(opponentId);
  if (rank == null) return undefined;
  return { opponentDefenseRank: rank, leagueSize: LEAGUE_SIZE, source: "MLB Stats API" };
}
