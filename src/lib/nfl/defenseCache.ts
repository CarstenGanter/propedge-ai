import "server-only";
import { cacheGet, cacheSet } from "@/lib/providerCache";
import {
  aggFromArray,
  aggToArray,
  aggregateDefense,
  extractTeamGameLines,
  type DefenseAgg,
  type EspnSummaryBox,
  type TeamGameLine,
} from "./defense";
import { getNflWeekEvents } from "./schedule";

/**
 * Incremental, resumable aggregation of opponent-allowed stats per team from
 * ESPN box scores. Only completed games not yet in the cache are fetched, so a
 * weekly refresh costs ~16 summary calls and a prior-season backfill is a
 * one-time ~272 calls (the summary endpoint is free and keyless).
 */

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";
const REGULAR_SEASON_WEEKS = 18;

interface GamesStore {
  season: number;
  eventIds: string[];
  lines: TeamGameLine[];
  updatedAt: string;
}

const gamesKey = (season: number) => `nfl:defense:games:${season}`;
const aggKey = (season: number) => `nfl:defense:agg:${season}`;

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T | null> {
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

export interface DefenseRefreshSummary {
  season: number;
  gamesKnown: number;
  gamesFetched: number;
  gamesFailed: number;
  teams: number;
}

/**
 * Scan regular-season weeks, fetch box scores for completed games that aren't
 * cached yet, and rebuild the per-team aggregate. Stops scanning at the first
 * week with no completed games whose kickoffs are all in the future.
 */
export async function refreshNflDefense(
  season: number,
  opts?: { throughWeek?: number; concurrency?: number; maxNewGames?: number },
): Promise<DefenseRefreshSummary> {
  const store: GamesStore =
    (await cacheGet<GamesStore>(gamesKey(season)))?.value ?? { season, eventIds: [], lines: [], updatedAt: "" };
  const known = new Set(store.eventIds);
  const pending: { eventId: string; week: number }[] = [];
  const now = Date.now();
  const lastWeek = Math.min(opts?.throughWeek ?? REGULAR_SEASON_WEEKS, REGULAR_SEASON_WEEKS);

  for (let week = 1; week <= lastWeek; week++) {
    const games = await getNflWeekEvents(season, week);
    if (games.length === 0) break;
    const completed = games.filter((g) => g.completed);
    for (const g of completed) if (!known.has(g.eventId)) pending.push({ eventId: g.eventId, week });
    const allFuture = games.every((g) => Date.parse(g.kickoffISO) > now);
    if (completed.length === 0 && allFuture) break;
  }

  const toFetch = opts?.maxNewGames != null ? pending.slice(0, opts.maxNewGames) : pending;
  const concurrency = opts?.concurrency ?? 4;
  let i = 0;
  let fetched = 0;
  let failed = 0;
  const newLines: TeamGameLine[] = [];
  const newIds: string[] = [];

  async function worker() {
    while (i < toFetch.length) {
      const job = toFetch[i++];
      const summary = await fetchJson<EspnSummaryBox>(`${SUMMARY}${job.eventId}`);
      if (!summary) {
        failed++;
        continue;
      }
      const lines = extractTeamGameLines(summary, { eventId: job.eventId, season, week: job.week });
      if (lines.length === 0) {
        failed++;
        continue;
      }
      newLines.push(...lines);
      newIds.push(job.eventId);
      fetched++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, toFetch.length) }, worker));

  if (fetched > 0) {
    store.eventIds = [...store.eventIds, ...newIds];
    store.lines = [...store.lines, ...newLines];
    store.updatedAt = new Date().toISOString();
    await cacheSet(gamesKey(season), store);
    const agg = aggregateDefense(store.lines);
    await cacheSet(aggKey(season), { season, updatedAt: store.updatedAt, teams: aggToArray(agg) });
  } else if (store.lines.length > 0 && !(await cacheGet(aggKey(season)))) {
    const agg = aggregateDefense(store.lines);
    await cacheSet(aggKey(season), { season, updatedAt: store.updatedAt, teams: aggToArray(agg) });
  }

  const agg = await getDefenseAgg(season);
  return {
    season,
    gamesKnown: store.eventIds.length,
    gamesFetched: fetched,
    gamesFailed: failed,
    teams: agg?.size ?? 0,
  };
}

/** Cached per-team aggregate for a season, or null when never built. */
export async function getDefenseAgg(season: number): Promise<Map<string, DefenseAgg> | null> {
  const hit = await cacheGet<{ teams: DefenseAgg[] }>(aggKey(season));
  if (!hit) return null;
  return aggFromArray(hit.value.teams);
}

export async function getDefenseAggMeta(season: number): Promise<{ updatedAt: string; games: number } | null> {
  const store = await cacheGet<GamesStore>(gamesKey(season));
  if (!store) return null;
  return { updatedAt: store.value.updatedAt, games: store.value.eventIds.length };
}
