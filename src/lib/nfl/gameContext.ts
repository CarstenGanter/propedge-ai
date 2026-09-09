import "server-only";
import { cacheGet, cacheSet } from "@/lib/providerCache";
import { parseInjuryReport, type EspnSummaryInjuries, type NflTeamInjuryReport } from "./injuryReport";
import {
  fetchHourlyForecast,
  openMeteoUrl,
  weatherAtKickoff,
  weatherConcern,
  type KickoffWeather,
  type WeatherAssessment,
} from "@/lib/providers/live/openMeteo";
import { stadiumForTeam, venueMatchesStadium, type Roof } from "./stadiums";
import { espnGameUrl, findNflGame, getNflSlate, type NflGame } from "./schedule";
import type { ScorablePropInput } from "@/types";

/**
 * Per-game context assembled from free sources and persisted in ProviderCache:
 *  - ESPN game summary → official game injury report (per team, per player),
 *    DraftKings spread/total via ESPN pickcenter, venue details.
 *  - Open-Meteo → temperature / wind / precipitation at the kickoff hour for
 *    outdoor stadiums (never fetched for domes).
 * Nothing here is interpreted beyond mapping ESPN's status words to our enum.
 */

const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";

export type { NflInjuryEntry, NflTeamInjuryReport } from "./injuryReport";

export interface NflGameContext {
  eventId: string;
  fetchedAt: string;
  kickoffISO: string;
  home: string;
  away: string;
  injuries: NflTeamInjuryReport[];
  /** True when ESPN published a report for at least one team. */
  injuryReportPublished: boolean;
  odds: { provider: string; details: string | null; overUnder: number | null; spread: number | null } | null;
  venue: { name: string | null; indoor: boolean | null; grass: boolean | null; roof: Roof | null; neutralSite: boolean };
  espnWeather: { text: string | null; tempF: number | null } | null;
  weather: KickoffWeather | null;
  assessment: WeatherAssessment | null;
  sourceUrl: string;
}

interface EspnSummaryJson extends EspnSummaryInjuries {
  pickcenter?: { provider?: { name?: string }; details?: string; overUnder?: number; spread?: number }[];
  gameInfo?: { venue?: { fullName?: string; grass?: boolean }; weather?: { temperature?: number; displayValue?: string } };
}

async function fetchJson<T>(url: string, timeoutMs = 9000): Promise<T | null> {
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

const CONTEXT_TTL = 30 * 60 * 1000;
const contextKey = (eventId: string) => `nfl:context:${eventId}`;

/** Cached context only (any age) — for page renders that must not block on network. */
export async function getCachedNflGameContext(eventId: string): Promise<NflGameContext | null> {
  const hit = await cacheGet<NflGameContext>(contextKey(eventId));
  return hit?.value ?? null;
}

/** Fetch (or reuse a fresh cached) context for a game. */
export async function getNflGameContext(game: NflGame, opts?: { maxAgeMs?: number }): Promise<NflGameContext | null> {
  const cached = await cacheGet<NflGameContext>(contextKey(game.eventId), opts?.maxAgeMs ?? CONTEXT_TTL);
  if (cached) return cached.value;

  const summary = await fetchJson<EspnSummaryJson>(`${SUMMARY}${game.eventId}`);
  if (!summary) {
    const stale = await cacheGet<NflGameContext>(contextKey(game.eventId));
    return stale?.value ?? null;
  }

  const injuries: NflTeamInjuryReport[] = parseInjuryReport(summary);
  const pc = summary.pickcenter?.[0];
  const odds = pc
    ? { provider: pc.provider?.name ?? "ESPN", details: pc.details ?? null, overUnder: pc.overUnder ?? null, spread: pc.spread ?? null }
    : null;

  // Weather: home stadium coordinates, unless ESPN says indoor or the venue is a neutral site.
  const stadium = stadiumForTeam(game.home.name);
  const venueName = game.venue ?? summary.gameInfo?.venue?.fullName ?? null;
  const neutralSite = stadium ? !venueMatchesStadium(venueName, stadium) : false;
  let roof: Roof | null = stadium?.roof ?? null;
  if (game.indoor === true) roof = "dome";
  if (neutralSite) roof = game.indoor === true ? "dome" : null;

  let weather: KickoffWeather | null = null;
  let assessment: WeatherAssessment | null = null;
  if (roof === "dome") {
    assessment = weatherConcern(null, "dome");
  } else if (stadium && !neutralSite && roof) {
    const forecast = await fetchHourlyForecast(stadium.lat, stadium.lon, stadium.tz);
    weather = forecast ? weatherAtKickoff(forecast, game.kickoffISO) : null;
    assessment = weatherConcern(weather, roof, { sourceUrl: openMeteoUrl(stadium.lat, stadium.lon, stadium.tz) });
  } else if (neutralSite) {
    assessment = {
      concern: false,
      note: `Neutral-site game at ${venueName ?? "an unlisted venue"} — kickoff forecast not evaluated.`,
      sourceName: "ESPN",
    };
  }

  const ctx: NflGameContext = {
    eventId: game.eventId,
    fetchedAt: new Date().toISOString(),
    kickoffISO: game.kickoffISO,
    home: game.home.name,
    away: game.away.name,
    injuries,
    injuryReportPublished: injuries.some((t) => t.players.length > 0),
    odds,
    venue: {
      name: venueName,
      indoor: game.indoor,
      grass: summary.gameInfo?.venue?.grass ?? null,
      roof,
      neutralSite,
    },
    espnWeather: game.weatherText || game.weatherTempF != null
      ? { text: game.weatherText, tempF: game.weatherTempF }
      : summary.gameInfo?.weather
        ? { text: summary.gameInfo.weather.displayValue ?? null, tempF: summary.gameInfo.weather.temperature ?? null }
        : null,
    weather,
    assessment,
    sourceUrl: espnGameUrl(game.eventId),
  };
  await cacheSet(contextKey(game.eventId), ctx);
  return ctx;
}

/** Warm contexts for a slate with bounded concurrency. */
export async function warmNflGameContexts(games: NflGame[], concurrency = 4): Promise<number> {
  let i = 0;
  let ok = 0;
  async function worker() {
    while (i < games.length) {
      const g = games[i++];
      const ctx = await getNflGameContext(g).catch(() => null);
      if (ctx) ok++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, worker));
  return ok;
}

/**
 * Context for a prop's game: by ESPN event id when the prop carries one,
 * otherwise by matching the slate's games on team names. Read-through to the
 * network only when nothing cached is fresh enough.
 */
export async function getNflGameContextForProp(
  prop: Pick<ScorablePropInput, "team" | "opponent" | "date" | "gameId">,
): Promise<{ game: NflGame | null; context: NflGameContext | null }> {
  if (!prop.date) return { game: null, context: null };
  const games = await getNflSlate(prop.date);
  const game =
    (prop.gameId ? games.find((g) => g.eventId === prop.gameId) : undefined) ??
    findNflGame(games, prop.team, prop.opponent) ??
    null;
  if (!game) {
    if (prop.gameId) {
      const cached = await getCachedNflGameContext(prop.gameId);
      return { game: null, context: cached };
    }
    return { game: null, context: null };
  }
  const context = await getNflGameContext(game);
  return { game, context };
}
