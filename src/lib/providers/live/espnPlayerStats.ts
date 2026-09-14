import type { PlayerStatsContext } from "@/types";
import { espnPathForSport, nameMatches, nameParts, normalizeName } from "./espn";
import { normalizeTeamName, lookupTeam } from "@/lib/utils/teamName";
import { nflSeasonForDate, seasonStartDate } from "@/lib/nfl/slate";

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
    // Combined yardage: a player with only one of the two columns (pure RB / pure WR
    // gamelogs) still counts — the missing side is 0, not "unknown".
    "Rush+Rec Yards": (n, s) => {
      const r = plainNum(col(n, s, "rushingYards"));
      const c = plainNum(col(n, s, "receivingYards"));
      return r == null && c == null ? null : (r ?? 0) + (c ?? 0);
    },
    "Pass Attempts": (n, s) => firstNum(col(n, s, "passingAttempts")),
    "Rush Attempts": (n, s) => plainNum(col(n, s, "rushingAttempts")),
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
    if (/Rush\+Rec/.test(propType)) {
      const a = plainNum(col(names, stats, "rushingAttempts"));
      const t = plainNum(col(names, stats, "receivingTargets"));
      return a == null && t == null ? null : (a ?? 0) + (t ?? 0);
    }
    if (/Rushing|Rush Attempts/.test(propType)) return plainNum(col(names, stats, "rushingAttempts"));
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

export interface BlendResult {
  parsed: ParsedGamelog;
  blended: boolean;
  currentGames: number;
  priorGamesUsed: number;
}

/** Re-order a row's stats from `fromNames` column order into `toNames` order. */
function realignRows(rows: GamelogRow[], fromNames: string[], toNames: string[]): GamelogRow[] {
  if (fromNames.length === toNames.length && fromNames.every((n, i) => n === toNames[i])) return rows;
  return rows.map((r) => ({
    ...r,
    stats: toNames.map((n) => {
      const i = fromNames.indexOf(n);
      return i >= 0 ? r.stats[i] ?? "" : "";
    }),
  }));
}

/**
 * Early-season sample blending (pure, tested). When fewer than `minCurrent`
 * games of the current season exist, append the most recent prior-season games
 * (from the same gamelog if ESPN still serves last season by default, else from
 * an explicit prior-season gamelog) up to `maxRows` total, current games first.
 */
export function blendGamelogs(
  current: ParsedGamelog,
  prior: ParsedGamelog | null,
  seasonStart: string,
  minCurrent = 4,
  maxRows = 17,
): BlendResult {
  const names = current.names.length ? current.names : prior?.names ?? [];
  const curRows = current.rows.filter((r) => r.date >= seasonStart);
  if (curRows.length >= minCurrent) {
    return { parsed: { names, rows: curRows }, blended: false, currentGames: curRows.length, priorGamesUsed: 0 };
  }
  const seen = new Set(curRows.map((r) => r.eventId));
  const priorRows: GamelogRow[] = [];
  for (const r of current.rows) {
    if (r.date < seasonStart && !seen.has(r.eventId)) {
      seen.add(r.eventId);
      priorRows.push(r);
    }
  }
  if (prior) {
    for (const r of realignRows(prior.rows, prior.names, names)) {
      if (r.date < seasonStart && !seen.has(r.eventId)) {
        seen.add(r.eventId);
        priorRows.push(r);
      }
    }
  }
  priorRows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const rows = [...curRows, ...priorRows].slice(0, maxRows);
  return {
    parsed: { names, rows },
    blended: rows.length > curRows.length,
    currentGames: curRows.length,
    priorGamesUsed: rows.length - curRows.length,
  };
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

/**
 * Pick the right roster entry for a player name (pure, exported for tests).
 *
 * `nameMatches` deliberately falls back to surname plus first initial, which
 * makes "Bijan Robinson" and "Brian Robinson Jr." match each other. Taking the
 * first fuzzy hit therefore silently returns a different human, and every stat,
 * matchup and injury signal downstream belongs to that other player. So: prefer
 * an exact full-name match, and when only ambiguous fuzzy candidates remain,
 * return null rather than guessing. Missing data is disclosed by the engine;
 * the wrong player's data is not.
 */
export function pickRosterMatch<T extends { name: string }>(
  roster: T[],
  playerName: string,
): { match: T | null; ambiguous: boolean } {
  const wanted = nameParts(playerName).join(" ");
  const exact = roster.filter((r) => nameParts(r.name).join(" ") === wanted);
  if (exact.length === 1) return { match: exact[0], ambiguous: false };
  if (exact.length > 1) return { match: null, ambiguous: true }; // true namesakes on one roster
  const fuzzy = roster.filter((r) => nameMatches(r.name, playerName));
  if (fuzzy.length === 1) return { match: fuzzy[0], ambiguous: false };
  return { match: null, ambiguous: fuzzy.length > 1 };
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
  // The teams must be part of the key: the same player name resolves against
  // different rosters in different games, and a cross-team namesake would
  // otherwise poison every later lookup for that name.
  const memoKey = `${family.sport}/${family.league}|${normalizeName(playerName)}|${normalizeTeamName(team)}|${normalizeTeamName(opponent)}`;
  if (resolveCache.has(memoKey)) return resolveCache.get(memoKey)!;

  const teams = await getTeams(family);
  const result = await (async (): Promise<EspnAthleteRef | null> => {
    // Exact matches win over fuzzy ones across BOTH rosters before falling back,
    // so an exact hit on the away roster beats a fuzzy hit on the home roster.
    const candidates: { teamId: string; teamName: string; roster: { id: string; name: string }[] }[] = [];
    for (const teamName of [team, opponent]) {
      const teamId = lookupTeam(teams, teamName);
      if (!teamId) continue;
      candidates.push({ teamId, teamName, roster: await getRoster(family, teamId) });
    }
    const wanted = nameParts(playerName).join(" ");
    const exact = candidates.flatMap((c) =>
      c.roster.filter((r) => nameParts(r.name).join(" ") === wanted).map((r) => ({ ...c, hit: r })),
    );
    if (exact.length === 1) {
      return { athleteId: exact[0].hit.id, teamId: exact[0].teamId, teamName: exact[0].teamName };
    }
    if (exact.length > 1) return null; // namesakes in the same game — refuse to guess
    const fuzzy = candidates.flatMap((c) =>
      c.roster.filter((r) => nameMatches(r.name, playerName)).map((r) => ({ ...c, hit: r })),
    );
    if (fuzzy.length === 1) {
      return { athleteId: fuzzy[0].hit.id, teamId: fuzzy[0].teamId, teamName: fuzzy[0].teamName };
    }
    return null;
  })();

  resolveCache.set(memoKey, result);
  return result;
}

async function getParsedGamelog(
  family: { sport: string; league: string },
  athleteId: string,
  season?: number,
): Promise<ParsedGamelog | null> {
  const key = `${family.sport}/${family.league}|${athleteId}|${season ?? "default"}`;
  const cached = gamelogCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.parsed;
  const url =
    `${WEB}/${family.sport}/${family.league}/athletes/${athleteId}/gamelog` + (season ? `?season=${season}` : "");
  const data = await fetchJson<GamelogJson>(url);
  if (!data) return null;
  const parsed = parseGamelog(data);
  gamelogCache.set(key, { at: Date.now(), parsed });
  return parsed;
}

/**
 * NFL: early in a season the sample is 0–3 games, so blend in last season's
 * games (labeled). Other sports return the default gamelog untouched.
 */
async function getGamelogForProp(
  sport: string,
  family: { sport: string; league: string },
  athleteId: string,
  date: string | null | undefined,
): Promise<{ parsed: ParsedGamelog; blend: BlendResult | null; season: number | null; prior: number | null } | null> {
  const parsed = await getParsedGamelog(family, athleteId);
  if (!parsed) return null;
  if (sport !== "NFL" || !date) return { parsed, blend: null, season: null, prior: null };
  const { season, prior } = nflSeasonForDate(date);
  const start = seasonStartDate(season);
  const currentGames = parsed.rows.filter((r) => r.date >= start).length;
  let priorParsed: ParsedGamelog | null = null;
  if (currentGames < 4 && !parsed.rows.some((r) => r.date < start)) {
    priorParsed = await getParsedGamelog(family, athleteId, prior);
  }
  const blend = blendGamelogs(parsed, priorParsed, start);
  return { parsed: blend.parsed, blend, season, prior };
}

function gamelogUrl(family: { sport: string; league: string }, athleteId: string): string {
  return `https://www.espn.com/${family.league}/player/gamelog/_/id/${athleteId}`;
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
  date?: string | null,
): Promise<PlayerStatsContext | undefined> {
  const family = espnFamily(sport);
  if (!family || !EXTRACTORS[family.sport]?.[propType]) return undefined;

  const ref = await resolveEspnAthlete(sport, playerName, team, opponent);
  if (!ref) return undefined;
  const log = await getGamelogForProp(sport, family, ref.athleteId, date);
  if (!log || log.parsed.rows.length === 0) return undefined;
  const parsed = log.parsed;
  const blend = log.blend;

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

  const blended = Boolean(blend?.blended);
  const note = blend?.blended
    ? `Sample includes ${blend.priorGamesUsed} game(s) from the ${log.prior} season (${blend.currentGames} of ${log.season} played).`
    : undefined;

  return {
    recentGames: games.slice(0, 15),
    seasonAverage: Math.round(mean(games) * 100) / 100,
    seasonMedian: median(games),
    seasonStdDev: Math.round(stdDev(games) * 100) / 100,
    gamesPlayed: games.length,
    usage,
    usageTrend,
    currentSeasonGames: blend ? blend.currentGames : undefined,
    note,
    source: blended ? `ESPN gamelog (${log.season} + ${log.prior} season)` : "ESPN gamelog",
    sourceUrl: gamelogUrl(family, ref.athleteId),
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
  date?: string | null,
): Promise<EspnGameRow[] | undefined> {
  const family = espnFamily(sport);
  if (!family) return undefined;
  const ref = await resolveEspnAthlete(sport, playerName, team, opponent);
  if (!ref) return undefined;
  const log = await getGamelogForProp(sport, family, ref.athleteId, date);
  if (!log) return undefined;
  const parsed = log.parsed;
  return parsed.rows.map((r) => ({
    date: r.date,
    homeAway: r.homeAway,
    opponentTeamId: r.opponentTeamId,
    value: extractStat(family.sport, propType, parsed.names, r.stats),
  }));
}

/** Concurrently pre-resolve + warm gamelogs so the scoring loop hits cache. */
export async function prewarmEspn(
  entries: {
    sport: string;
    league: string;
    playerName: string;
    team: string;
    opponent: string;
    propType: string;
    date?: string | null;
  }[],
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
      await getEspnPlayerStats(e.sport, e.playerName, e.team, e.opponent, e.propType, e.date).catch(() => undefined);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, unique.length) }, worker));
}
