import "server-only";
import { cacheGet, cacheSet } from "@/lib/providerCache";
import { teamsMatch } from "@/lib/utils/teamName";
import { addDaysToSlate } from "@/lib/utils/dates";

/**
 * NFL schedule from ESPN's public scoreboard (free, no key). `?dates=YYYYMMDD`
 * returns that Eastern-time day's games; `?dates=YYYY&seasontype=2&week=N`
 * returns a whole regular-season week. Cached in ProviderCache so the headless
 * job and the web app share it.
 */

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export interface NflTeamRef {
  id: string;
  name: string;
  abbr: string;
  score: number | null;
}

export interface NflGame {
  eventId: string;
  kickoffISO: string;
  week: number | null;
  home: NflTeamRef;
  away: NflTeamRef;
  venue: string | null;
  indoor: boolean | null;
  weatherText: string | null;
  weatherTempF: number | null;
  spreadText: string | null;
  overUnder: number | null;
  completed: boolean;
  statusText: string | null;
}

interface EspnScoreboard {
  week?: { number?: number };
  events?: {
    id: string;
    date?: string;
    week?: { number?: number };
    status?: { type?: { completed?: boolean; shortDetail?: string } };
    weather?: { displayValue?: string; temperature?: number };
    competitions?: {
      venue?: { fullName?: string; indoor?: boolean };
      odds?: { details?: string; overUnder?: number }[];
      competitors?: {
        homeAway?: string;
        score?: string;
        team?: { id?: string; displayName?: string; abbreviation?: string };
      }[];
      status?: { type?: { completed?: boolean; shortDetail?: string } };
    }[];
  }[];
}

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

function parseGames(data: EspnScoreboard | null): NflGame[] {
  const weekNum = data?.week?.number ?? null;
  const out: NflGame[] = [];
  for (const ev of data?.events ?? []) {
    const comp = ev.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === "home");
    const away = comp?.competitors?.find((c) => c.homeAway === "away");
    if (!ev.date || !home?.team?.displayName || !away?.team?.displayName) continue;
    const toRef = (c: NonNullable<typeof home>): NflTeamRef => ({
      id: String(c.team?.id ?? ""),
      name: c.team?.displayName ?? "",
      abbr: c.team?.abbreviation ?? "",
      score: c.score != null && c.score !== "" && Number.isFinite(Number(c.score)) ? Number(c.score) : null,
    });
    const status = comp?.status?.type ?? ev.status?.type;
    out.push({
      eventId: ev.id,
      kickoffISO: ev.date,
      week: ev.week?.number ?? weekNum,
      home: toRef(home),
      away: toRef(away),
      venue: comp?.venue?.fullName ?? null,
      indoor: comp?.venue?.indoor ?? null,
      weatherText: ev.weather?.displayValue ?? null,
      weatherTempF: ev.weather?.temperature ?? null,
      spreadText: comp?.odds?.[0]?.details ?? null,
      overUnder: comp?.odds?.[0]?.overUnder ?? null,
      completed: Boolean(status?.completed),
      statusText: status?.shortDetail ?? null,
    });
  }
  out.sort((a, b) => a.kickoffISO.localeCompare(b.kickoffISO));
  return out;
}

const SLATE_TTL = 10 * 60 * 1000;

/** Games on an Eastern-time slate date ("YYYY-MM-DD"). */
export async function getNflSlate(date: string, opts?: { maxAgeMs?: number }): Promise<NflGame[]> {
  const key = `nfl:slate:${date}`;
  const cached = await cacheGet<NflGame[]>(key, opts?.maxAgeMs ?? SLATE_TTL);
  if (cached) return cached.value;
  const data = await fetchJson<EspnScoreboard>(`${SCOREBOARD}?dates=${date.replace(/-/g, "")}`);
  if (!data) {
    const stale = await cacheGet<NflGame[]>(key);
    return stale?.value ?? [];
  }
  const games = parseGames(data);
  await cacheSet(key, games);
  return games;
}

/** Every game of a regular-season week (for defense aggregation). */
export async function getNflWeekEvents(season: number, week: number): Promise<NflGame[]> {
  const data = await fetchJson<EspnScoreboard>(`${SCOREBOARD}?dates=${season}&seasontype=2&week=${week}`);
  return parseGames(data);
}

/**
 * The slate to show: `from` if it has games, else the next date with games
 * within `lookahead` days. Each probe is one free scoreboard call (cached).
 */
export async function resolveNflSlateDate(
  from: string,
  lookahead = 8,
): Promise<{ date: string; isToday: boolean; games: NflGame[] } | null> {
  for (let i = 0; i <= lookahead; i++) {
    const d = addDaysToSlate(from, i);
    const games = await getNflSlate(d);
    if (games.length > 0) return { date: d, isToday: i === 0, games };
  }
  return null;
}

/** Previous slate date with games within `lookback` days, if any. */
export async function previousNflSlateDate(from: string, lookback = 8): Promise<string | null> {
  for (let i = 1; i <= lookback; i++) {
    const d = addDaysToSlate(from, -i);
    const games = await getNflSlate(d);
    if (games.length > 0) return d;
  }
  return null;
}

export function findNflGame(games: NflGame[], team: string, opponent: string): NflGame | undefined {
  return games.find(
    (g) =>
      (teamsMatch(g.home.name, team) && teamsMatch(g.away.name, opponent)) ||
      (teamsMatch(g.home.name, opponent) && teamsMatch(g.away.name, team)),
  );
}

export function espnGameUrl(eventId: string): string {
  return `https://www.espn.com/nfl/game/_/gameId/${eventId}`;
}
