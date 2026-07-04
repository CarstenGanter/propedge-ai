import type { PlayerStatsContext } from "@/types";
import { normalizeTeamName } from "@/lib/utils/teamName";

/**
 * MLB Stats API (statsapi.mlb.com) — free, no key. Resolves a player by name
 * from the season roster, pulls their game log, and maps it to the scoring
 * engine's PlayerStatsContext. Defensive: any failure returns undefined.
 */

const BASE = "https://statsapi.mlb.com/api/v1";

function currentSeason(): number {
  return new Date().getFullYear();
}

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");
function norm(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- player id resolution (season roster cached in-memory) ----

interface RosterEntry {
  id: number;
  fullName: string;
  isPitcher: boolean;
  teamId: number | null;
}
let rosterCache: { season: number; byName: Map<string, RosterEntry> } | null = null;

async function getRoster(season: number): Promise<Map<string, RosterEntry> | null> {
  if (rosterCache && rosterCache.season === season) return rosterCache.byName;
  const data = await fetchJson<{
    people: {
      id: number;
      fullName: string;
      primaryPosition?: { abbreviation?: string };
      currentTeam?: { id?: number };
    }[];
  }>(`${BASE}/sports/1/players?season=${season}`);
  if (!data?.people) return null;
  const byName = new Map<string, RosterEntry>();
  for (const p of data.people) {
    byName.set(norm(p.fullName), {
      id: p.id,
      fullName: p.fullName,
      isPitcher: p.primaryPosition?.abbreviation === "P",
      teamId: p.currentTeam?.id ?? null,
    });
  }
  rosterCache = { season, byName };
  return byName;
}

async function resolvePlayer(name: string, season: number): Promise<RosterEntry | null> {
  const roster = await getRoster(season);
  if (!roster) return null;
  const key = norm(name);
  if (roster.has(key)) return roster.get(key)!;
  // fall back to last-name + first-initial match
  const [first, ...rest] = key.split(" ");
  const last = rest[rest.length - 1];
  for (const [k, v] of roster) {
    const parts = k.split(" ");
    if (parts[parts.length - 1] === last && parts[0]?.[0] === first?.[0]) return v;
  }
  return null;
}

// ---- prop → stat mapping ----

type Group = "hitting" | "pitching";
interface StatMap {
  group: Group;
  extract: (s: Record<string, unknown>) => number | null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const PROP_STATS: Record<string, StatMap> = {
  "Total Bases": { group: "hitting", extract: (s) => num(s.totalBases) },
  Hits: { group: "hitting", extract: (s) => num(s.hits) },
  RBIs: { group: "hitting", extract: (s) => num(s.rbi) },
  Runs: { group: "hitting", extract: (s) => num(s.runs) },
  "Hits+Runs+RBIs": {
    group: "hitting",
    extract: (s) => {
      const h = num(s.hits);
      const r = num(s.runs);
      const rbi = num(s.rbi);
      return h == null || r == null || rbi == null ? null : h + r + rbi;
    },
  },
  Strikeouts: { group: "pitching", extract: (s) => num(s.strikeOuts) },
};

// ---- game log: cache RAW splits per player+group, extract per prop ----

const logCache = new Map<string, { at: number; splits: Record<string, unknown>[] }>();
const LOG_TTL = 10 * 60 * 1000;

async function getGameLogSplits(
  playerId: number,
  group: Group,
  season: number,
): Promise<Record<string, unknown>[]> {
  const cacheKey = `${playerId}|${group}|${season}`;
  const cached = logCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LOG_TTL) return cached.splits;

  const data = await fetchJson<{
    stats?: { splits?: { stat?: Record<string, unknown> }[] }[];
  }>(`${BASE}/people/${playerId}/stats?stats=gameLog&group=${group}&season=${season}`);

  const splits = (data?.stats?.[0]?.splits ?? [])
    .map((sp) => sp.stat)
    .filter((s): s is Record<string, unknown> => Boolean(s));
  logCache.set(cacheKey, { at: Date.now(), splits });
  return splits;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdDev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Resolve + fetch a player's stats for a prop type. Undefined if unavailable. */
export async function getMlbPlayerStats(
  playerName: string,
  propType: string,
): Promise<PlayerStatsContext | undefined> {
  const map = PROP_STATS[propType];
  if (!map) return undefined;
  const season = currentSeason();
  const player = await resolvePlayer(playerName, season);
  if (!player) return undefined;
  const splits = await getGameLogSplits(player.id, map.group, season);
  if (splits.length === 0) return undefined;

  // API returns chronological; reverse for most-recent-first semantics.
  const games = splits
    .map((s) => map.extract(s))
    .filter((v): v is number => v != null)
    .reverse();
  if (games.length === 0) return undefined;

  // Usage/role proxy: plate appearances (batters) or innings pitched (pitchers).
  const usageField = map.group === "hitting" ? "plateAppearances" : "inningsPitched";
  const usageVals = splits
    .map((s) => Number(s[usageField]))
    .filter((v) => Number.isFinite(v))
    .reverse();
  let usage: number | undefined;
  let usageTrend: "up" | "down" | "steady" | undefined;
  if (usageVals.length >= 3) {
    usage = Math.round(mean(usageVals) * 10) / 10;
    const recent = mean(usageVals.slice(0, 5));
    const overall = mean(usageVals);
    usageTrend = recent > overall * 1.08 ? "up" : recent < overall * 0.92 ? "down" : "steady";
  }

  return {
    recentGames: games.slice(0, 15),
    seasonAverage: Math.round(mean(games) * 100) / 100,
    seasonMedian: median(games),
    seasonStdDev: Math.round(stdDev(games) * 100) / 100,
    gamesPlayed: games.length,
    usage,
    usageTrend,
    source: "MLB Stats API",
  };
}

/** Resolve a player's current MLB team id (for matchup lookups). */
export async function resolvePlayerTeamId(playerName: string): Promise<number | null> {
  const player = await resolvePlayer(playerName, currentSeason());
  return player?.teamId ?? null;
}

/**
 * Actual final stat for a player on a given date, for settlement. Fetches the
 * game log FRESH (bypassing the pre-game cache) and returns the dated split's
 * value, or null if the game isn't final / the player didn't appear.
 */
export async function getMlbResult(
  playerName: string,
  propType: string,
  date: string,
): Promise<number | null> {
  const map = PROP_STATS[propType];
  if (!map) return null;
  const season = currentSeason();
  const player = await resolvePlayer(playerName, season);
  if (!player) return null;

  const data = await fetchJson<{
    stats?: { splits?: { date?: string; stat?: Record<string, unknown> }[] }[];
  }>(`${BASE}/people/${player.id}/stats?stats=gameLog&group=${map.group}&season=${season}`);

  const splits = data?.stats?.[0]?.splits ?? [];
  // A player can have two splits on a doubleheader date — sum them.
  const dayStats = splits.filter((s) => s.date === date && s.stat).map((s) => s.stat!);
  if (dayStats.length === 0) return null;
  let total = 0;
  for (const st of dayStats) {
    const v = map.extract(st);
    if (v == null) return null;
    total += v;
  }
  return total;
}

/** Resolve a player's id, team, and role for news/lineup lookups. */
export async function resolvePlayerInfo(
  playerName: string,
): Promise<{ id: number; teamId: number | null; isPitcher: boolean } | null> {
  const p = await resolvePlayer(playerName, currentSeason());
  return p ? { id: p.id, teamId: p.teamId, isPitcher: p.isPitcher } : null;
}

export function mlbSeason(): number {
  return currentSeason();
}

/** Shared defensive JSON fetch for other MLB modules. */
export async function mlbFetch<T>(path: string): Promise<T | null> {
  return fetchJson<T>(`${BASE}${path}`);
}

// ------------------------------------------------------------------
// Team-level data for the Team Picks (game-winner) vertical.
// All free / no-key from statsapi.mlb.com. Defensive: null/empty on failure.
// ------------------------------------------------------------------

const numOrUndef = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Rich team form for one MLB club, derived from the standings endpoint. */
export interface MlbTeamForm {
  teamId: number;
  record: string; // "49-39"
  winPct: number; // 0..1
  homeWinPct?: number;
  awayWinPct?: number;
  last10Pct?: number;
  homeRecord?: string;
  awayRecord?: string;
  last10Record?: string;
  runDifferential?: number;
  streakCode?: string; // e.g. "W3", "L2"
}

interface StandingsSplit {
  type?: string; // "home" | "away" | "lastTen" | ...
  wins?: number;
  losses?: number;
}
interface StandingsTeamRecord {
  team?: { id?: number; name?: string };
  wins?: number;
  losses?: number;
  winningPercentage?: string;
  runDifferential?: number;
  streak?: { streakCode?: string };
  records?: { splitRecords?: StandingsSplit[] };
}
interface StandingsResponse {
  records?: { teamRecords?: StandingsTeamRecord[] }[];
}

let standingsCache: { day: string; byName: Map<string, MlbTeamForm> } | null = null;

const splitPct = (s?: StandingsSplit): number | undefined =>
  s && s.wins != null && s.losses != null && s.wins + s.losses > 0
    ? s.wins / (s.wins + s.losses)
    : undefined;
const splitRecord = (s?: StandingsSplit): string | undefined =>
  s && s.wins != null && s.losses != null ? `${s.wins}-${s.losses}` : undefined;

/**
 * MLB standings for the current season → map of normalized team name → rich
 * form (win %, home/away splits, last-10, run differential, streak). One HTTP
 * call covers all 30 teams; cached per calendar day.
 */
export async function getMlbStandings(): Promise<Map<string, MlbTeamForm> | null> {
  const day = new Date().toISOString().slice(0, 10);
  if (standingsCache && standingsCache.day === day) return standingsCache.byName;

  const season = currentSeason();
  const data = await fetchJson<StandingsResponse>(
    `${BASE}/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`,
  );
  if (!data?.records) return null;

  const byName = new Map<string, MlbTeamForm>();
  for (const division of data.records) {
    for (const tr of division.teamRecords ?? []) {
      const name = tr.team?.name;
      if (!name) continue;
      const splits = tr.records?.splitRecords ?? [];
      const find = (type: string) => splits.find((s) => s.type === type);
      const home = find("home");
      const away = find("away");
      const last10 = find("lastTen");
      const wins = tr.wins ?? 0;
      const losses = tr.losses ?? 0;
      byName.set(normalizeTeamName(name), {
        teamId: tr.team?.id ?? 0,
        record: `${wins}-${losses}`,
        winPct: numOrUndef(tr.winningPercentage) ?? (wins + losses > 0 ? wins / (wins + losses) : 0.5),
        homeWinPct: splitPct(home),
        awayWinPct: splitPct(away),
        last10Pct: splitPct(last10),
        homeRecord: splitRecord(home),
        awayRecord: splitRecord(away),
        last10Record: splitRecord(last10),
        runDifferential: numOrUndef(tr.runDifferential),
        streakCode: tr.streak?.streakCode,
      });
    }
  }
  standingsCache = { day, byName };
  return byName;
}

/** Probable starting pitcher (with season ERA/WHIP) for one team on a date. */
export interface ProbableStarter {
  name: string;
  era?: number;
  whip?: number;
}

interface ScheduleResponse {
  dates?: {
    games?: {
      teams?: {
        home?: { team?: { id?: number; name?: string }; probablePitcher?: { id?: number; fullName?: string } };
        away?: { team?: { id?: number; name?: string }; probablePitcher?: { id?: number; fullName?: string } };
      };
    }[];
  }[];
}

async function getPitcherSeasonStats(id: number): Promise<{ era?: number; whip?: number } | null> {
  const data = await fetchJson<{
    stats?: { splits?: { stat?: { era?: string; whip?: string } }[] }[];
  }>(`${BASE}/people/${id}/stats?stats=season&group=pitching&season=${currentSeason()}`);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) return null;
  return { era: numOrUndef(stat.era), whip: numOrUndef(stat.whip) };
}

/**
 * Probable starters for every MLB game on a date → map of normalized team name
 * → starter with season ERA/WHIP. One schedule call + one stat call per starter.
 */
export async function getMlbProbableStarters(dateYYYYMMDD: string): Promise<Map<string, ProbableStarter>> {
  const map = new Map<string, ProbableStarter>();
  const data = await fetchJson<ScheduleResponse>(
    `${BASE}/schedule?sportId=1&date=${dateYYYYMMDD}&hydrate=probablePitcher`,
  );
  const games = data?.dates?.[0]?.games ?? [];

  const entries: { teamName: string; pitcherId: number; name: string }[] = [];
  for (const g of games) {
    for (const side of ["home", "away"] as const) {
      const t = g.teams?.[side];
      const pp = t?.probablePitcher;
      if (t?.team?.name && pp?.id) {
        entries.push({ teamName: t.team.name, pitcherId: pp.id, name: pp.fullName ?? "" });
      }
    }
  }

  const ids = [...new Set(entries.map((e) => e.pitcherId))];
  const statById = new Map<number, { era?: number; whip?: number } | null>();
  await Promise.all(
    ids.map(async (id) => {
      statById.set(id, await getPitcherSeasonStats(id).catch(() => null));
    }),
  );

  for (const e of entries) {
    const s = statById.get(e.pitcherId) ?? null;
    map.set(normalizeTeamName(e.teamName), { name: e.name, era: s?.era, whip: s?.whip });
  }
  return map;
}

/** Concurrently pre-fetch game logs for a set of players to speed up generation. */
export async function prewarmMlb(names: string[], propTypes: string[]): Promise<void> {
  const unique = [...new Set(names)];
  const limit = 6;
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const name = unique[i++];
      // one representative propType is enough to warm the roster + log cache
      for (const pt of propTypes) {
        if (PROP_STATS[pt]) {
          await getMlbPlayerStats(name, pt).catch(() => undefined);
          break;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}
