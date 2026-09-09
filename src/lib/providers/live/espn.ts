import type { Sport } from "@/types";

/**
 * Best-effort integration with ESPN's public (no-key) site API. Everything here
 * is defensive: any network/parse failure returns null so the app falls back to
 * manual/demo data. These endpoints are undocumented and may change.
 */

const SPORT_PATH: Partial<Record<Sport, { sport: string; league: string }>> = {
  NFL: { sport: "football", league: "nfl" },
  NBA: { sport: "basketball", league: "nba" },
  NCAAB: { sport: "basketball", league: "mens-college-basketball" },
  MLB: { sport: "baseball", league: "mlb" },
  WNBA: { sport: "basketball", league: "wnba" },
  NHL: { sport: "hockey", league: "nhl" },
  Soccer: { sport: "soccer", league: "usa.1" },
};

/** Soccer spans competitions; map a prop's competition label to its ESPN path. */
const SOCCER_LEAGUE_PATH: Record<string, string> = {
  "World Cup": "fifa.world",
  MLS: "usa.1",
};

/** Resolve the ESPN {sport,league} path, routing soccer by its competition label. */
function pathFor(sport: string, league?: string): { sport: string; league: string } | null {
  const base = SPORT_PATH[sport as Sport];
  if (!base) return null;
  if (sport === "Soccer" && league && SOCCER_LEAGUE_PATH[league]) {
    return { sport: "soccer", league: SOCCER_LEAGUE_PATH[league] };
  }
  return base;
}

export function espnSupportsSport(sport: string): boolean {
  return sport in SPORT_PATH;
}

/** Exported path resolver so other live modules share one sport→{sport,league} map. */
export function espnPathForSport(
  sport: string,
  league?: string,
): { sport: string; league: string } | null {
  return pathFor(sport, league);
}

async function fetchJson<T = unknown>(
  url: string,
  timeoutMs = 6000,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      // Live sports data changes constantly; never serve stale.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

export function nameMatches(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const aParts = na.split(/\s+/);
  const bParts = nb.split(/\s+/);
  // last name + first initial match
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  return aLast === bLast && aParts[0]?.[0] === bParts[0]?.[0];
}

interface EspnEvent {
  id: string;
  competitions?: {
    competitors?: { team?: { displayName?: string; abbreviation?: string; name?: string } }[];
    status?: { type?: { completed?: boolean } };
  }[];
  status?: { type?: { completed?: boolean } };
}

/** Find a completed (or any) event on a date that involves both teams. */
export async function findEvent(
  sport: string,
  dateYYYYMMDD: string,
  team: string,
  opponent: string,
  league?: string,
): Promise<{ eventId: string; completed: boolean } | null> {
  const path = pathFor(sport, league);
  if (!path) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/scoreboard?dates=${dateYYYYMMDD}`;
  const data = await fetchJson<{ events?: EspnEvent[] }>(url);
  if (!data?.events) return null;

  const teamMatches = (name: string | undefined, target: string) => {
    if (!name) return false;
    const n = normalizeName(name);
    const t = normalizeName(target);
    return n.includes(t) || t.includes(n) || n.split(/\s+/).some((w) => t.includes(w) && w.length > 3);
  };

  for (const ev of data.events) {
    const comp = ev.competitions?.[0];
    const names = comp?.competitors?.map((c) => c.team?.displayName ?? c.team?.name ?? "") ?? [];
    const hasTeam = names.some((n) => teamMatches(n, team));
    const hasOpp = names.some((n) => teamMatches(n, opponent));
    if (hasTeam && hasOpp) {
      const completed =
        comp?.status?.type?.completed ?? ev.status?.type?.completed ?? false;
      return { eventId: ev.id, completed };
    }
  }
  return null;
}

export interface EspnEventMeta {
  eventId: string;
  dateISO: string | null;
  homeTeamName: string | null;
  awayTeamName: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

interface EspnScoreboardEvent {
  id: string;
  date?: string;
  competitions?: {
    competitors?: {
      homeAway?: string;
      team?: { id?: string; displayName?: string; name?: string };
    }[];
  }[];
}

/**
 * Full event metadata (home/away team names + ids + start time) for a game on a
 * date involving both teams. Used to derive home/away splits & rest days.
 */
export async function findEventMeta(
  sport: string,
  dateYYYYMMDD: string,
  team: string,
  opponent: string,
  league?: string,
): Promise<EspnEventMeta | null> {
  const path = pathFor(sport, league);
  if (!path) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/scoreboard?dates=${dateYYYYMMDD}`;
  const data = await fetchJson<{ events?: EspnScoreboardEvent[] }>(url);
  if (!data?.events) return null;

  const teamMatches = (name: string | undefined, target: string) => {
    if (!name) return false;
    const n = normalizeName(name);
    const t = normalizeName(target);
    return n.includes(t) || t.includes(n) || n.split(/\s+/).some((w) => t.includes(w) && w.length > 3);
  };

  for (const ev of data.events) {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    const names = competitors.map((c) => c.team?.displayName ?? c.team?.name ?? "");
    if (names.some((n) => teamMatches(n, team)) && names.some((n) => teamMatches(n, opponent))) {
      return {
        eventId: ev.id,
        dateISO: ev.date ?? null,
        homeTeamName: home?.team?.displayName ?? home?.team?.name ?? null,
        awayTeamName: away?.team?.displayName ?? away?.team?.name ?? null,
        homeTeamId: home?.team?.id ?? null,
        awayTeamId: away?.team?.id ?? null,
      };
    }
  }
  return null;
}

// Candidate ESPN stat labels/abbreviations per prop type (lowercased contains-match).
const STAT_MATCHERS: Record<string, string[]> = {
  points: ["pts", "points"],
  rebounds: ["reb", "rebounds"],
  assists: ["ast", "assists"],
  "3-pointers made": ["3pt", "3pm", "three point"],
  "passing yards": ["passing yards", "yds"],
  "rushing yards": ["rushing yards", "rush yds"],
  "receiving yards": ["receiving yards", "rec yds"],
  receptions: ["receptions", "rec"],
  "shots on goal": ["sog", "shots"],
  goals: ["g", "goals"],
  saves: ["saves", "sv"],
  hits: ["h", "hits"],
  "total bases": ["tb", "total bases"],
  strikeouts: ["k", "so", "strikeouts"],
  rbis: ["rbi", "rbis"],
};

export interface EspnBoxAthlete {
  athlete?: { displayName?: string };
  stats?: string[];
}
export interface EspnStatGroup {
  name?: string;
  labels?: string[];
  names?: string[];
  keys?: string[];
  athletes?: EspnBoxAthlete[];
}
interface EspnTeamPlayers {
  statistics?: EspnStatGroup[];
}
interface EspnSummary {
  boxscore?: { players?: EspnTeamPlayers[] };
}

/**
 * NFL box scores: labels are generic ("YDS", "REC", "TD") and repeat across the
 * passing/rushing/receiving groups, so football settlement matches on the
 * group's `name` and its machine `keys` instead. A compound key like
 * "completions/passingAttempts" is split with `part`.
 */
interface FootballBoxKey {
  group: string;
  key: string;
  part?: "first" | "second";
}
const FOOTBALL_BOX_KEYS: Record<string, FootballBoxKey[]> = {
  "passing yards": [{ group: "passing", key: "passingYards" }],
  "rushing yards": [{ group: "rushing", key: "rushingYards" }],
  "receiving yards": [{ group: "receiving", key: "receivingYards" }],
  receptions: [{ group: "receiving", key: "receptions" }],
  "pass tds": [{ group: "passing", key: "passingTouchdowns" }],
  completions: [{ group: "passing", key: "completions/passingAttempts", part: "first" }],
  "pass attempts": [{ group: "passing", key: "completions/passingAttempts", part: "second" }],
  "rush attempts": [{ group: "rushing", key: "rushingAttempts" }],
  "rush+rec yards": [
    { group: "rushing", key: "rushingYards" },
    { group: "receiving", key: "receivingYards" },
  ],
};

function parsePart(raw: string, part?: "first" | "second"): number | null {
  const pieces = String(raw).split("/");
  const piece = part === "second" ? pieces[1] : pieces[0];
  if (piece == null) return null;
  const n = Number(piece.split("-")[0]);
  return Number.isNaN(n) ? null : n;
}

/**
 * Pure football box-score extractor (exported for tests). Returns null when the
 * player appears in none of the relevant groups (DNP → manual settlement). For
 * summed props, a player present in one group but not the other counts 0 there.
 */
export function extractFootballBoxStat(
  groups: EspnStatGroup[],
  playerName: string,
  propType: string,
): number | null {
  const spec = FOOTBALL_BOX_KEYS[propType.toLowerCase()];
  if (!spec) return null;
  let total = 0;
  let found = false;
  for (const { group, key, part } of spec) {
    for (const g of groups) {
      if ((g.name ?? "").toLowerCase() !== group) continue;
      const idx = (g.keys ?? []).indexOf(key);
      if (idx < 0) continue;
      const ath = (g.athletes ?? []).find(
        (a) => a.athlete?.displayName && nameMatches(a.athlete.displayName, playerName),
      );
      if (!ath) continue;
      const raw = ath.stats?.[idx];
      if (raw == null) continue;
      const n = parsePart(raw, part);
      if (n == null) continue;
      total += n;
      found = true;
    }
  }
  return found ? total : null;
}

/** Pull a single completed-game stat for a player from the box score. */
export async function fetchPlayerGameStat(
  sport: string,
  eventId: string,
  playerName: string,
  propType: string,
  league?: string,
): Promise<number | null> {
  const path = pathFor(sport, league);
  if (!path) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/summary?event=${eventId}`;
  const data = await fetchJson<EspnSummary>(url);
  const teams = data?.boxscore?.players;
  if (!teams) return null;

  if (path.sport === "football") {
    const groups = teams.flatMap((t) => t.statistics ?? []);
    return extractFootballBoxStat(groups, playerName, propType);
  }

  const matchers = STAT_MATCHERS[propType.toLowerCase()];
  if (!matchers) return null;

  for (const team of teams) {
    for (const group of team.statistics ?? []) {
      const labels = (group.labels ?? group.names ?? group.keys ?? []).map((l) =>
        l.toLowerCase(),
      );
      const statIdx = labels.findIndex((l) => matchers.some((m) => l === m || l.includes(m)));
      if (statIdx < 0) continue;
      for (const ath of group.athletes ?? []) {
        if (ath.athlete?.displayName && nameMatches(ath.athlete.displayName, playerName)) {
          const raw = ath.stats?.[statIdx];
          if (raw == null) continue;
          const num = Number(String(raw).split("-")[0]);
          if (!Number.isNaN(num)) return num;
        }
      }
    }
  }
  return null;
}
