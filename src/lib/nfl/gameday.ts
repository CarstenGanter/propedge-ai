import "server-only";
import { prisma } from "@/lib/db/client";
import { getPicksForDate, getTeamPicksForDate } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { hasKey } from "@/lib/providers/config";
import { getOddsCredits } from "@/lib/providerCache";
import { teamsMatch } from "@/lib/utils/teamName";
import { addDaysToSlate } from "@/lib/utils/dates";
import type { SerializedPick, SerializedTeamPick } from "@/lib/dto";
import type { ScoringProfile } from "@/types";
import { findNflGame, getNflSlate, previousNflSlateDate, resolveNflSlateDate, type NflGame } from "./schedule";
import { getCachedNflGameContext, type NflGameContext } from "./gameContext";
import { getDefenseAggMeta } from "./defenseCache";
import { nflSeasonForDate } from "./slate";
import { marketsToDrop } from "@/lib/analysis/availability";

export interface NflGamedayGame {
  game: NflGame;
  context: NflGameContext | null;
  picks: SerializedPick[];
  teamPick: SerializedTeamPick | null;
}

export interface NflGamedayData {
  date: string;
  isToday: boolean;
  week: number | null;
  games: NflGamedayGame[];
  /** NFL picks for the date that could not be matched to an ESPN game. */
  unmatchedPicks: SerializedPick[];
  prevDate: string | null;
  nextDate: string | null;
  pickCount: number;
  /** Pending picks on this slate that have no closing line recorded yet. */
  awaitingClosingLines: number;
  /** Minutes until the earliest remaining kickoff, or null if all have started. */
  minutesToKickoff: number | null;
  pendingPropCount: number;
  /**
   * Markets you pay for every slate that the pick'em platform has never once
   * been seen to post. Credits are charged per market per game, so these are a
   * standing cost with no possible return.
   */
  marketsToDrop: string[];
  contextsCached: number;
  credits: { remaining: number; at: string } | null;
  defense: { season: number; games: number; updatedAt: string } | null;
  settings: {
    markets: string[];
    maxGames: number;
    floor: number;
    profile: ScoringProfile;
    defaultStake: number;
    oddsConfigured: boolean;
    nflEnabled: boolean;
    demoMode: boolean;
    enableWebResearch: boolean;
  };
}

/** Everything the /nfl page needs for a slate, reading contexts from cache only (never blocks on network). */
export async function getNflGamedayData(date: string, today: string): Promise<NflGamedayData> {
  const [slate, picksAll, teamPicks, settings, credits, pendingPropCount, prevDate, nextResolved] = await Promise.all([
    getNflSlate(date),
    getPicksForDate(date),
    getTeamPicksForDate(date),
    getSettings(),
    getOddsCredits(),
    prisma.playerProp.count({ where: { date, sport: "NFL", status: "pending" } }),
    previousNflSlateDate(date),
    resolveNflSlateDate(addDaysToSlate(date, 1)),
  ]);

  const picks = picksAll.filter((p) => p.prop.sport === "NFL");
  const nflTeamPicks = teamPicks.filter((t) => t.league === "NFL");
  const contexts = await Promise.all(slate.map((g) => getCachedNflGameContext(g.eventId)));

  const matched = new Set<string>();
  const games: NflGamedayGame[] = slate.map((game, i) => {
    const gamePicks = picks.filter((p) => {
      const g = findNflGame([game], p.prop.team, p.prop.opponent);
      if (g) matched.add(p.id);
      return Boolean(g);
    });
    const teamPick =
      nflTeamPicks.find((t) => teamsMatch(t.homeTeam, game.home.name) && teamsMatch(t.awayTeam, game.away.name)) ??
      null;
    return { game, context: contexts[i], picks: gamePicks, teamPick };
  });

  const { season } = nflSeasonForDate(date);
  const [defenseMeta, availabilityRows] = await Promise.all([
    getDefenseAggMeta(season),
    // Every NFL prop ever checked, not just this slate — one game is far too
    // little evidence to retire a market on.
    prisma.playerProp.findMany({
      where: { sport: "NFL", underdogAvailable: { not: null } },
      select: { propType: true, underdogAvailable: true },
    }),
  ]);
  const droppable = marketsToDrop(
    availabilityRows.map((r) => ({ propType: r.propType, available: r.underdogAvailable })),
  ).filter((m) => settings.nflMarkets.includes(m));

  return {
    date,
    isToday: date === today,
    week: slate[0]?.week ?? null,
    games,
    unmatchedPicks: picks.filter((p) => !matched.has(p.id)),
    prevDate,
    nextDate: nextResolved?.date ?? null,
    pickCount: picks.length,
    awaitingClosingLines: picks.filter((p) => p.status === "pending" && !p.closingCaptured).length,
    minutesToKickoff: (() => {
      const upcoming = slate
        .map((g) => Date.parse(g.kickoffISO))
        .filter((t) => Number.isFinite(t) && t > Date.now());
      if (upcoming.length === 0) return null;
      return Math.round((Math.min(...upcoming) - Date.now()) / 60000);
    })(),
    pendingPropCount,
    marketsToDrop: droppable,
    contextsCached: contexts.filter(Boolean).length,
    credits: credits ? { remaining: credits.remaining, at: credits.at } : null,
    defense: defenseMeta ? { season, games: defenseMeta.games, updatedAt: defenseMeta.updatedAt } : null,
    settings: {
      markets: settings.nflMarkets,
      maxGames: settings.nflMaxGames,
      floor: settings.oddsCreditFloor,
      profile: settings.scoringProfile,
      defaultStake: settings.defaultStake,
      oddsConfigured: hasKey("ODDS_API_KEY"),
      nflEnabled: settings.sportsEnabled.map((s) => s.toLowerCase()).includes("nfl"),
      demoMode: settings.demoMode,
      enableWebResearch: settings.enableWebResearch,
    },
  };
}
