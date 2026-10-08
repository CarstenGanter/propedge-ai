import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchMoneylines } from "@/lib/providers/live/theOddsApiTeams";
import { fetchPlayerProps, oddsApiSupportsSport } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { teamsMatch } from "@/lib/utils/teamName";
import { isLeague, type League } from "@/lib/teamLeagues";
import { todaySlate } from "@/lib/utils/dates";
import { toNflSlateDate } from "@/lib/nfl/slate";
import { nameMatch } from "@/lib/utils/playerName";
import { consensusProbOver } from "@/lib/analysis/marketConsensus";
import { playedLine } from "@/lib/settlement";
import { recordOddsCredits } from "@/lib/providerCache";
import type { Sport, TeamSide } from "@/types";

export interface CaptureSummary {
  ok: boolean;
  teamPicksUpdated: number;
  propPicksUpdated: number;
  creditsRemaining: number | null;
  /** Games a paid request returned odds for. A game missing here cost nothing. */
  pricedGames?: { home: string; away: string }[];
  error?: string;
}

/**
 * Record the current market line as the "closing" line for still-pending picks,
 * so we can compute Closing Line Value at settlement. Best run near game time.
 * Team lines are cheap (bulk h2h ~1 credit/league); prop lines are per-event and
 * credit-heavy, so they're capped and can be skipped.
 */
export async function captureClosingLines(opts?: {
  date?: string;
  includeProps?: boolean;
  maxEventsPerSport?: number;
  /** Also re-price moneyline team picks (default true). */
  includeTeamPicks?: boolean;
  /**
   * Skip picks that already have a closing line. The scheduled job runs many
   * times a day, and must never pay twice for the same game.
   */
  onlyUncaptured?: boolean;
  /** Only re-price events that pass this test — nothing is paid for the rest. */
  eventFilter?: (event: { commence_time: string; home_team: string; away_team: string }) => boolean;
  /** Restrict prop capture to these sports. */
  sports?: Sport[];
}): Promise<CaptureSummary> {
  if (!hasKey("ODDS_API_KEY")) {
    return { ok: false, teamPicksUpdated: 0, propPicksUpdated: 0, creditsRemaining: null, error: "No ODDS_API_KEY set in .env" };
  }
  const date = opts?.date ?? todaySlate();
  const apiKey = process.env.ODDS_API_KEY!;
  let creditsRemaining: number | null = null;

  // ---- Team picks (moneyline) — cheap bulk fetch per league ----
  const teamPicks =
    opts?.includeTeamPicks === false
      ? []
      : await prisma.teamPick.findMany({
          where: { date, status: "pending", isDemo: false },
        });
  const leagues = [...new Set(teamPicks.map((p) => p.league))].filter(isLeague) as League[];
  let teamPicksUpdated = 0;

  for (const league of leagues) {
    const ml = await fetchMoneylines(league, apiKey);
    if (ml.creditsRemaining != null) creditsRemaining = ml.creditsRemaining;
    await recordOddsCredits(ml.creditsRemaining, null);
    if (!ml.ok) continue;
    for (const pick of teamPicks.filter((p) => p.league === league)) {
      const game = ml.games.find(
        (g) => teamsMatch(g.homeTeam, pick.homeTeam) && teamsMatch(g.awayTeam, pick.awayTeam),
      );
      if (!game) continue; // game not upcoming (started/final) or unmatched — skip
      const side = pick.recommendedSide as TeamSide;
      const closingWinProb = side === "HOME" ? game.homeProb : side === "AWAY" ? game.awayProb : game.drawProb;
      const closingPrice = side === "HOME" ? game.homePrice : side === "AWAY" ? game.awayPrice : game.drawPrice;
      await prisma.teamPick.update({
        where: { id: pick.id },
        data: { closingWinProb, closingPrice: closingPrice ?? null, closingCapturedAt: new Date() },
      });
      teamPicksUpdated++;
    }
  }

  // ---- Player props — per-event, credit-heavy, capped & opt-in ----
  let propPicksUpdated = 0;
  const pricedGames: { home: string; away: string }[] = [];
  let fetchError: string | undefined;
  if (opts?.includeProps !== false) {
    const picks = await prisma.pick.findMany({
      where: {
        date,
        status: "pending",
        isDemo: false,
        ...(opts?.onlyUncaptured ? { closingProb: null } : {}),
      },
      include: { playerProp: true },
    });
    const marketPicks = picks.filter((p) => p.playerProp.source === "The Odds API");
    const sports = [...new Set(marketPicks.map((p) => p.playerProp.sport))]
      .filter(oddsApiSupportsSport)
      .filter((s) => !opts?.sports || opts.sports.includes(s as Sport)) as Sport[];

    for (const sport of sports) {
      const sportPicks = marketPicks.filter((p) => p.playerProp.sport === sport);
      // Only re-price the markets we actually hold picks in, and (NFL) only that slate's games.
      const propTypes = [...new Set(sportPicks.map((p) => p.playerProp.propType))];
      const res = await fetchPlayerProps(apiKey, sport, {
        maxEvents: opts?.maxEventsPerSport ?? 8,
        propTypes,
        eventFilter: opts?.eventFilter,
        ...(sport === "NFL" ? { slateDate: date, toSlate: toNflSlateDate } : {}),
      });
      if (res.status.remaining != null) creditsRemaining = res.status.remaining;
      await recordOddsCredits(res.status.remaining, res.status.used);
      pricedGames.push(...res.pricedEvents);
      if (res.status.error) fetchError = res.status.error;
      if (res.props.length === 0) continue;
      for (const pick of marketPicks.filter((p) => p.playerProp.sport === sport)) {
        const pp = pick.playerProp;
        const np = res.props.find(
          (x) =>
            x.propType === pp.propType &&
            nameMatch(x.playerName, pp.playerName) &&
            ((teamsMatch(x.homeTeam, pp.team) && teamsMatch(x.awayTeam, pp.opponent)) ||
              (teamsMatch(x.homeTeam, pp.opponent) && teamsMatch(x.awayTeam, pp.team))),
        );
        if (!np) continue;
        // Read the close at the line actually played, as the entry was, so CLV
        // compares one line at two moments rather than two different lines.
        const pOverClose = np.consensus
          ? consensusProbOver(np.consensus, playedLine(pp.line, pp.underdogLine))
          : np.noVigProbOver;
        const closingProb = pp.direction === "OVER" ? pOverClose : 1 - pOverClose;
        await prisma.pick.update({
          where: { id: pick.id },
          data: { closingProb, closingCapturedAt: new Date() },
        });
        propPicksUpdated++;
      }
    }
  }

  return { ok: true, teamPicksUpdated, propPicksUpdated, creditsRemaining, pricedGames, ...(fetchError ? { error: fetchError } : {}) };
}
