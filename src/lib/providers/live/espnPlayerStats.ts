import type { PlayerStatsContext } from "@/types";
import { espnPathForSport, nameMatches } from "./espn";
import { normalizeTeamName, lookupTeam } from "@/lib/utils/teamName";

/**
 * ESPN athlete game logs (free, no key) for NBA / WNBA / NFL / NHL / NCAAB —
 * the non-MLB player-stats source. Resolves a player to an ESPN athlete id via
 * team rosters, pulls their gamelog, and maps it to PlayerStatsContext.
 * Defensive: any failure returns undefined; column lookups go through the
 * gamelog's own `names[]` (never `labels[]`, which has duplicates).
 *
 * Verified endpoint shapes (see plan): gamelog values are string arrays parallel
 * to top-level `names[]`; per-game metadata lives in the top-level `events{}`
 * map; the All-Star game hides inside the Regular Season season type and must be
 * excluded (`events[id].team.isAllStar`).
 */

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";

/** ESPN path family for a sport, or null if this module doesn't cover it. */
function espnFamily(sport: string): { sport: string; league: string } | null {
  if (sport === "MLB" || sport === "Soccer") return null; // MLB has its own module; soccer deferred
  return espnPathForSport(sport);
}

// ---- value extraction (all keyed off the gamelog's names[]) ----

const col = (names: string[], stats: string[], name: string): string | undefined => {
  const i = names.indexOf(name);
  return i >= 0 ? stats[i] : undefined;
};
const firstNum = (v: string | undefined): number | null => {
  if (v == null) return null;
  const n = Number(String(v).split("-")[0]);
  return Number.isFinite(n) ? n : null;
};
const plainNum = (v: string | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

type Extractor = (names: string[], stats: string[]) => number | null;

const EXTRACTORS: Record<string, Record<string, Extractor>> = {
  basketball: {
    Points: (n, s) => plainNum(col(n, s, "points")),
    Rebounds: (n, s) => plainNum(col(n, s, "totalRebounds")),
    Assists: (n, s) => plainNum(col(n, s, "assists")),
    "Pts+Reb+Ast": (n, s) => {
      const p = plainNum(col(n, s, "points"));
      const r = plainNum(col(n, s, "totalRebounds"));
      const a = plainNum(col(n, s, "assists"));
      return p == null || r == null || a == null ? null : p + r + a;
    },
    "3-Pointers Made": (n, s) =>
      firstNum(col(n, s, "threePointFieldGoalsMade-threePointFieldGoalsAttempted")),
    "Steals+Blocks": (n, s) => {
      const st = plainNum(col(n, s, "steals"));
      const bl = plainNum(col(n, s, "blocks"));
      return st == null || bl == null ? null : st + bl;
    },
  },
  football: {
    "Passing Yards": (n, s) => plainNum(col(n, s, "passingYards")),
    "Rushing Yards": (n, s) => plainNum(col(n, s, "rushingYards")),
    "Receiving Yards": (n, s) => plainNum(col(n, s, "receivingYards")),
    Receptions: (n, s) => plainNum(col(n, s, "receptions")),
    "Pass TDs": (n, s) => plainNum(col(n, s, "passingTouchdowns")),
    Completions: (n, s) => firstNum(col(n, s, "completions")),
  },
  hockey: {
    "Shots on Goal": (n, s) => plainNum(col(n, s, "shotsTotal")),
    Points: (n, s) => plainNum(col(n, s, "points")),
    Goals: (n, s) => plainNum(col(n, s, "goals")),
    Assists: (n, s) => plainNum(col(n, s, "assists")),
    Saves: (n, s) => plainNum(col(n, s, "saves")), // unverified column — null if absent
    "Blocked Shots": (n, s) => plainNum(col(n, s, "blockedShots")), // unverified
  },
};

/** Usage/role proxy column per sport family + prop. */
function usageValue(family: string, propType: string, names: string[], stats: string[]): number | null {
  if (family === "basketball") return plainNum(col(names, stats, "minutes"));
  if (family === "hockey") return parseTOI(col(names, stats, "timeOnIcePerGame"));
  if (family === "football") {
    if (/Rushing/.test(propType)) return plainNum(col(names, stats, "rushingAttempts"));
    if (/Receiving|Reception/.test(propType)) return plainNum(col(names, stats, "receivingTargets"));
    return firstNum(col(names, stats, "passingAttempts"));
  }
  return null;
}

function parseTOI(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^(\d+):(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- gamelog parsing (pure, exported for tests) ----

export interface GamelogRow {
  eventId: string;
  date: string; // ISO
  homeAway: "home" | "away" | null;
  opponentTeamId: string | null;
  stats: string[];
}
export interface ParsedGamelog {
  names: string[];
  rows: GamelogRow[]; // most-recent-first
}

interface GamelogJson {
  names?: string[];
  seasonTypes?: {
    displayName?: string;
    categories?: { events?: { eventId?: string; stats?: string[] }[] }[];
  }[];
  events?: Record<
    string,
    {
      gameDate?: string;
      homeTeamId?: string | number;
      opponent?: { id?: string | number };
      team?: { id?: string | number; isAllStar?: boolean };
      eventNote?: string;
    }
  >;
}

/** Parse an ESPN gamelog JSON into ordered rows, excluding preseason & All-Star games. */
export function parseGamelog(json: GamelogJson): ParsedGamelog {
  const names = json.names ?? [];
  const meta = json.events ?? {};
  const rows: GamelogRow[] = [];

  for (const st of json.seasonTypes ?? []) {
    const label = (st.displayName ?? "").toLowerCase();
    // Count regular season (and postseason); never preseason.
    if (!/regular season|postseason/.test(label)) continue;
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        if (!ev.eventId || !ev.stats) continue;
        const m = meta[ev.eventId];
        if (!m) continue;
        if (m.team?.isAllStar || /all-?star/i.test(m.eventNote ?? "")) continue;
        const teamId = m.team?.id != null ? String(m.team.id) : null;
        const homeId = m.homeTeamId != null ? String(m.homeTeamId) : null;
        rows.push({
          eventId: ev.eventId,
          date: m.gameDate ?? "",
          homeAway: teamId && homeId ? (teamId === homeId ? "home" : "away") : null,
          opponentTeamId: m.opponent?.id != null ? String(m.opponent.id) : null,
          stats: ev.stats,
        });
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // date desc
  return { names, rows };
}

/** Extract one prop's per-game value from a row (exported for tests). */
export function extractStat(
  family: string,
  propType: string,
  names: string[],
  stats: string[],
): number | null {
  return EXTRACTORS[family]?.[propType]?.(names, stats) ?? null;
}

// ---- network + caches ----

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const teamsCache = new Map<string, { at: number; byName: Map<string, string> }>(); // norm name → teamId
const rosterCache = new Map<string, { at: number; athletes: { id: string; name: string }[] }>();
const gamelogCache = new Map<string, { at: number; parsed: ParsedGamelog }>();
const resolveCache = new Map<string, EspnAthleteRef | null>();

export interface EspnAthleteRef {
  athleteId: string;
  teamId: string;
  teamName: string;
}

async function getTeams(family: { sport: string; league: string }): Promise<Map<string, string>> {
  const key = `${family.sport}/${family.league}`;
  const cached = teamsCache.get(key);
  if (cached && Date.now() - cached.at < DAY) return cached.byName;
  const data = await fetchJson<{
    sports?: { leagues?: { teams?: { team?: { id?: string; displayName?: string; location?: string; name?: string } }[] }[] }[];
  }>(`${SITE}/${family.sport}/${family.league}/teams?limit=500`);
  const byName = new Map<string, string>();
  for (const t of data?.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    const team = t.team;
    if (!team?.id) continue;
    for (const n of [team.displayName, team.name, team.location].filter(Boolean) as string[]) {
      byName.set(normalizeTeamName(n), String(team.id));
    }
  }
  teamsCache.set(key, { at: Date.now(), byName });
  return byName;
}

interface RosterAthlete {
  id?: string;
  fullName?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  items?: RosterAthlete[];
}

async function getRoster(family: { sport: string; league: string }, teamId: string): Promise<{ id: string; name: string }[]> {
  const key = `${family.sport}/${family.league}|${teamId}`;
  const cached = rosterCache.get(key);
  if (cached && Date.now() - cached.at < DAY / 4) return cached.athletes; // 6h
  const data = await fetchJson<{ athletes?: RosterAthlete[] }>(
    `${SITE}/${family.sport}/${family.league}/teams/${teamId}/roster`,
  );
  const flat: { id: string; name: string }[] = [];
  for (const a of data?.athletes ?? []) {
    const list = a.items ?? [a]; // NFL groups athletes by position → flatten items
    for (const p of list) {
      if (p.id && (p.fullName || p.displayName)) flat.push({ id: String(p.id), name: p.fullName ?? p.displayName ?? "" });
    }
  }
  rosterCache.set(key, { at: Date.now(), athletes: flat });
  return flat;
}

/** Resolve a player to an ESPN athlete id by scanning both teams' rosters. */
export async function resolveEspnAthlete(
  sport: string,
  playerName: string,
  team: string,
  opponent: string,
): Promise<EspnAthleteRef | null> {
  const family = espnFamily(sport);
  if (!family) return null;
  const memoKey = `${family.sport}/${family.league}|${normalizeTeamName(playerName)}`;
  if (resolveCache.has(memoKey)) return resolveCache.get(memoKey)!;

  const teams = await getTeams(family);
  const result = await (async (): Promise<EspnAthleteRef | null> => {
    for (const teamName of [team, opponent]) {
      const teamId = lookupTeam(teams, teamName);
      if (!teamId) continue;
      const roster = await getRoster(family, teamId);
      const hit = roster.find((r) => nameMatches(r.name, playerName));
      if (hit) return { athleteId: hit.id, teamId, teamName };
    }
    return null;
  })();

  resolveCache.set(memoKey, result);
  return result;
}

async function getParsedGamelog(family: { sport: string; league: string }, athleteId: string): Promise<ParsedGamelog | null> {
  const key = `${family.sport}/${family.league}|${athleteId}`;
  const cached = gamelogCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.parsed;
  const data = await fetchJson<GamelogJson>(`${WEB}/${family.sport}/${family.league}/athletes/${athleteId}/gamelog`);
  if (!data) return null;
  const parsed = parseGamelog(data);
  gamelogCache.set(key, { at: Date.now(), parsed });
  return parsed;
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

/** Resolve + fetch a non-MLB player's stats for a prop type. Undefined if unavailable. */
export async function getEspnPlayerStats(
  sport: string,
  playerName: string,
  team: string,
  opponent: string,
  propType: string,
): Promise<PlayerStatsContext | undefined> {
  const family = espnFamily(sport);
  if (!family || !EXTRACTORS[family.sport]?.[propType]) return undefined;

  const ref = await resolveEspnAthlete(sport, playerName, team, opponent);
  if (!ref) return undefined;
  const parsed = await getParsedGamelog(family, ref.athleteId);
  if (!parsed || parsed.rows.length === 0) return undefined;

  const games = parsed.rows
    .map((r) => extractStat(family.sport, propType, parsed.names, r.stats))
    .filter((v): v is number => v != null);
  if (games.length === 0) return undefined;

  const usageVals = parsed.rows
    .map((r) => usageValue(family.sport, propType, parsed.names, r.stats))
    .filter((v): v is number => v != null);
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
    source: "ESPN",
  };
}

/** Per-game rows (date, home/away, opponent, value) for the historical provider. */
export interface EspnGameRow {
  date: string;
  homeAway: "home" | "away" | null;
  opponentTeamId: string | null;
  value: number | null;
}

export async function getEspnGameRows(
  sport: string,
  playerName: string,
  team: string,
  opponent: string,
  propType: string,
): Promise<EspnGameRow[] | undefined> {
  const family = espnFamily(sport);
  if (!family) return undefined;
  const ref = await resolveEspnAthlete(sport, playerName, team, opponent);
  if (!ref) return undefined;
  const parsed = await getParsedGamelog(family, ref.athleteId);
  if (!parsed) return undefined;
  return parsed.rows.map((r) => ({
    date: r.date,
    homeAway: r.homeAway,
    opponentTeamId: r.opponentTeamId,
    value: extractStat(family.sport, propType, parsed.names, r.stats),
  }));
}

/** Concurrently pre-resolve + warm gamelogs so the scoring loop hits cache. */
export async function prewarmEspn(
  entries: { sport: string; league: string; playerName: string; team: string; opponent: string; propType: string }[],
): Promise<void> {
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const k = `${e.sport}|${normalizeTeamName(e.playerName)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const limit = 5;
  let i = 0;
  async function worker() {
    while (i < unique.length) {
      const e = unique[i++];
      await getEspnPlayerStats(e.sport, e.playerName, e.team, e.opponent, e.propType).catch(() => undefined);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, unique.length) }, worker));
}
