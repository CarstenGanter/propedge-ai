import "server-only";
import { getSettings } from "@/lib/settings";
import { hasKey } from "@/lib/providers/config";
import { estimateCredits, filterEventsForSlate, listEvents } from "@/lib/providers/live/theOddsApi";
import { getOddsCredits, recordOddsCredits } from "@/lib/providerCache";
import { ingestOddsPropsForSport } from "@/lib/oddsIngest";
import { generatePicksForDate, type GenerationSummary } from "@/lib/generate";
import { generateTeamPicksForDate, type TeamGenerationSummary } from "@/lib/generateTeams";
import { findNflGame, getNflSlate, type NflGame } from "./schedule";
import { warmNflGameContexts } from "./gameContext";
import { getDefenseAgg, refreshNflDefense, type DefenseRefreshSummary } from "./defenseCache";
import { nflSeasonForDate, toNflSlateDate } from "./slate";

/**
 * NFL game-day orchestration. Everything except the Odds API pull is free:
 * ESPN slate → (credit estimate + floor check) → Odds API props for that
 * slate's games only → game contexts (injury reports, odds, weather) → defense
 * aggregates (new box scores only) → ranked picks.
 */

export interface NflFetchEstimate {
  date: string;
  gamesOnSlate: number; // per ESPN
  gamesPriced: number; // per The Odds API events list (what would be charged)
  gamesToFetch: number; // after the max-games cap
  markets: string[];
  credits: number;
  creditsKnownRemaining: number | null;
  creditsAfter: number | null;
  floor: number;
  allowed: boolean;
  reason?: string;
}

export async function estimateNflFetch(date: string): Promise<NflFetchEstimate> {
  const settings = await getSettings();
  const markets = settings.nflMarkets;
  const floor = settings.oddsCreditFloor;
  const slate = await getNflSlate(date);
  const base: NflFetchEstimate = {
    date,
    gamesOnSlate: slate.length,
    gamesPriced: 0,
    gamesToFetch: 0,
    markets,
    credits: 0,
    creditsKnownRemaining: (await getOddsCredits())?.remaining ?? null,
    creditsAfter: null,
    floor,
    allowed: false,
  };
  if (!hasKey("ODDS_API_KEY")) return { ...base, reason: "No ODDS_API_KEY set in .env" };
  if (slate.length === 0) return { ...base, reason: `No NFL games on ${date}` };
  if (markets.length === 0) return { ...base, reason: "No NFL markets enabled in Settings" };

  const listed = await listEvents(process.env.ODDS_API_KEY!, "NFL"); // free
  await recordOddsCredits(listed.status.remaining, listed.status.used);
  const remaining = listed.status.remaining ?? base.creditsKnownRemaining;
  const priced = filterEventsForSlate(
    listed.events.map((e) => ({ ...e, commence_time: e.commenceTime })),
    date,
    toNflSlateDate,
  ).filter((e) => Date.parse(e.commence_time) > Date.now() - 3 * 3600_000);
  const gamesToFetch = Math.min(priced.length, settings.nflMaxGames);
  const credits = estimateCredits(gamesToFetch, markets.length);
  const creditsAfter = remaining != null ? remaining - credits : null;
  const est: NflFetchEstimate = {
    ...base,
    gamesPriced: priced.length,
    gamesToFetch,
    credits,
    creditsKnownRemaining: remaining,
    creditsAfter,
    allowed: gamesToFetch > 0 && (creditsAfter == null || creditsAfter >= floor),
  };
  if (!listed.status.ok) est.reason = listed.status.error ?? "The Odds API request failed";
  else if (priced.length === 0) est.reason = "The Odds API lists no upcoming games for this date (already started, or not posted yet)";
  else if (!est.allowed) est.reason = `Would leave ${creditsAfter} credits, below your floor of ${floor}`;
  return est;
}

export interface NflPrepareSummary {
  contextsWarmed: number;
  defense: { season: DefenseRefreshSummary | null; prior: DefenseRefreshSummary | null };
  nflverse: { season: number; idMapPlayers: number; weeklyRows: number; snapRows: number; latestWeek: number | null } | null;
}

/**
 * Free research prep for a slate: game contexts (injury report / odds /
 * weather) and defense aggregates. Backfills the prior season once.
 */
export async function prepareNflResearch(date: string, slate?: NflGame[]): Promise<NflPrepareSummary> {
  const games = slate ?? (await getNflSlate(date));
  const contextsWarmed = games.length ? await warmNflGameContexts(games) : 0;
  const { season, prior } = nflSeasonForDate(date);
  // Snap share / target share for the whole league, free and keyless.
  const { refreshNflverse } = await import("@/lib/providers/live/nflverse");
  const nflverse = await refreshNflverse(season).catch(() => null);
  const seasonSummary = await refreshNflDefense(season).catch(() => null);
  let priorSummary: DefenseRefreshSummary | null = null;
  if (!(await getDefenseAgg(prior))) {
    priorSummary = await refreshNflDefense(prior).catch(() => null);
  }
  return { contextsWarmed, defense: { season: seasonSummary, prior: priorSummary }, nflverse };
}

export interface NflIngestSummary {
  ok: boolean;
  date: string;
  skipped: boolean;
  reason?: string;
  gamesOnSlate: number;
  estimate: NflFetchEstimate | null;
  propsImported: number;
  creditsRemaining: number | null;
  prepare: NflPrepareSummary | null;
  picks: GenerationSummary | null;
  teamPicks: TeamGenerationSummary | null;
  error?: string;
}

export async function ingestNflSlate(
  date: string,
  opts?: { onlyIfGameday?: boolean; includeTeamPicks?: boolean; skipOddsFetch?: boolean },
): Promise<NflIngestSummary> {
  const slate = await getNflSlate(date);
  const summary: NflIngestSummary = {
    ok: true,
    date,
    skipped: false,
    gamesOnSlate: slate.length,
    estimate: null,
    propsImported: 0,
    creditsRemaining: null,
    prepare: null,
    picks: null,
    teamPicks: null,
  };
  if (slate.length === 0 && opts?.onlyIfGameday) {
    return { ...summary, skipped: true, reason: `No NFL games on ${date} — nothing fetched (0 credits).` };
  }

  if (!opts?.skipOddsFetch) {
    const estimate = await estimateNflFetch(date);
    summary.estimate = estimate;
    summary.creditsRemaining = estimate.creditsKnownRemaining;
    if (estimate.allowed) {
      const settings = await getSettings();
      const r = await ingestOddsPropsForSport("NFL", {
        maxEvents: settings.nflMaxGames,
        slateDate: date,
        toSlate: toNflSlateDate,
        propTypes: settings.nflMarkets,
        gameIdResolver: (home, away) => findNflGame(slate, home, away)?.eventId ?? null,
      });
      summary.propsImported = r.imported;
      summary.creditsRemaining = r.creditsRemaining ?? summary.creditsRemaining;
      if (!r.ok) summary.error = r.error;
    } else {
      summary.reason = estimate.reason;
    }
  }

  summary.prepare = await prepareNflResearch(date, slate);
  summary.picks = await generatePicksForDate(date);
  if (opts?.includeTeamPicks) {
    summary.teamPicks = await generateTeamPicksForDate(date);
    if (summary.teamPicks.creditsRemaining != null) summary.creditsRemaining = summary.teamPicks.creditsRemaining;
  }
  return summary;
}
