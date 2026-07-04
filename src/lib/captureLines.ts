import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchMoneylines } from "@/lib/providers/live/theOddsApiTeams";
import { fetchPlayerProps, oddsApiSupportsSport } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { teamsMatch } from "@/lib/utils/teamName";
import { isLeague, type League } from "@/lib/teamLeagues";
import { todaySlate } from "@/lib/utils/dates";
import type { Sport, TeamSide } from "@/types";

export interface CaptureSummary {
  ok: boolean;
  teamPicksUpdated: number;
  propPicksUpdated: number;
  creditsRemaining: number | null;
  error?: string;
}

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function nameMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  const ap = na.split(" ");
  const bp = nb.split(" ");
  return ap[ap.length - 1] === bp[bp.length - 1] && ap[0]?.[0] === bp[0]?.[0];
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
}): Promise<CaptureSummary> {
  if (!hasKey("ODDS_API_KEY")) {
    return { ok: false, teamPicksUpdated: 0, propPicksUpdated: 0, creditsRemaining: null, error: "No ODDS_API_KEY set in .env" };
  }
  const date = opts?.date ?? todaySlate();
  const apiKey = process.env.ODDS_API_KEY!;
  let creditsRemaining: number | null = null;

  // ---- Team picks (moneyline) — cheap bulk fetch per league ----
  const teamPicks = await prisma.teamPick.findMany({
    where: { date, status: "pending", isDemo: false },
  });
  const leagues = [...new Set(teamPicks.map((p) => p.league))].filter(isLeague) as League[];
  let teamPicksUpdated = 0;

  for (const league of leagues) {
    const ml = await fetchMoneylines(league, apiKey);
    if (ml.creditsRemaining != null) creditsRemaining = ml.creditsRemaining;
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
  if (opts?.includeProps !== false) {
    const picks = await prisma.pick.findMany({
      where: { date, status: "pending", isDemo: false },
      include: { playerProp: true },
    });
    const marketPicks = picks.filter((p) => p.playerProp.source === "The Odds API");
    const sports = [...new Set(marketPicks.map((p) => p.playerProp.sport))].filter(oddsApiSupportsSport) as Sport[];

    for (const sport of sports) {
      const res = await fetchPlayerProps(apiKey, sport, opts?.maxEventsPerSport ?? 8);
      if (res.status.remaining != null) creditsRemaining = res.status.remaining;
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
        const closingProb = pp.direction === "OVER" ? np.noVigProbOver : 1 - np.noVigProbOver;
        await prisma.pick.update({
          where: { id: pick.id },
          data: { closingProb, closingCapturedAt: new Date() },
        });
        propPicksUpdated++;
      }
    }
  }

  return { ok: true, teamPicksUpdated, propPicksUpdated, creditsRemaining };
}
