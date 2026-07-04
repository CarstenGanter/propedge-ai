import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { toSlateDate } from "@/lib/utils/dates";
import type { Sport } from "@/types";

export interface OddsIngestResult {
  ok: boolean;
  sport: string;
  imported: number;
  events: number;
  creditsRemaining: number | null;
  dates: string[];
  error?: string;
}

/**
 * Fetch, de-vig, and store player props for a sport from The Odds API.
 * Replaces any existing pending Odds-API props for that sport. Does NOT
 * revalidate or generate — callers (server action / job) do that.
 */
export async function ingestOddsPropsForSport(
  sport: Sport,
  maxEvents = 10,
): Promise<OddsIngestResult> {
  if (!hasKey("ODDS_API_KEY")) {
    return { ok: false, sport, imported: 0, events: 0, creditsRemaining: null, dates: [], error: "No ODDS_API_KEY set in .env" };
  }

  const result = await fetchPlayerProps(process.env.ODDS_API_KEY!, sport, maxEvents);
  if (result.props.length === 0) {
    return {
      ok: false,
      sport,
      imported: 0,
      events: result.events,
      creditsRemaining: result.status.remaining,
      dates: [],
      error: result.status.error ?? "No player props returned (sport may be out of season).",
    };
  }

  await prisma.playerProp.deleteMany({
    where: { source: "The Odds API", sport, status: "pending" },
  });

  const dates = new Set<string>();
  const rows = result.props.map((p) => {
    const date = toSlateDate(new Date(p.commenceTime));
    dates.add(date);
    return {
      date,
      sport,
      league: p.league || sport,
      playerName: p.playerName,
      team: p.homeTeam,
      opponent: p.awayTeam,
      propType: p.propType,
      line: p.line,
      direction: p.direction,
      source: "The Odds API",
      projection: p.projection,
      gameStartTime: new Date(p.commenceTime),
      marketDataJson: JSON.stringify({
        noVigProbOver: p.noVigProbOver,
        comparableLines: p.comparableLines,
        bookCount: p.bookCount,
        projection: p.projection,
        marketLine: p.line,
        source: "The Odds API",
      }),
      isDemo: false,
    };
  });

  await prisma.playerProp.createMany({ data: rows });

  return {
    ok: true,
    sport,
    imported: rows.length,
    events: result.events,
    creditsRemaining: result.status.remaining,
    dates: [...dates],
  };
}
