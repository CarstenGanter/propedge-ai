import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { recordOddsCredits } from "@/lib/providerCache";
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

export interface IngestOptions {
  /** Max games to pull (each costs one credit per market). */
  maxEvents?: number;
  /** Only pull games on this slate date (mapped by `toSlate`); also scopes the replace-delete to that date. */
  slateDate?: string;
  /** Kickoff ISO → slate date. Defaults to the machine-local day; NFL passes an Eastern-time mapper. */
  toSlate?: (iso: string) => string;
  /** Restrict markets to these prop types (labels from PROP_TYPES). */
  propTypes?: string[];
  /** Resolve an external game id (e.g. ESPN event id) for a matchup, stored on each prop. */
  gameIdResolver?: (homeTeam: string, awayTeam: string, commenceTime: string) => string | null;
}

/**
 * Fetch, de-vig, and store player props for a sport from The Odds API.
 * Replaces existing pending Odds-API props for that sport (for the slate date
 * only, when one is given). Does NOT revalidate or generate — callers do that.
 */
export async function ingestOddsPropsForSport(
  sport: Sport,
  opts: IngestOptions | number = {},
): Promise<OddsIngestResult> {
  const options: IngestOptions = typeof opts === "number" ? { maxEvents: opts } : opts;
  if (!hasKey("ODDS_API_KEY")) {
    return { ok: false, sport, imported: 0, events: 0, creditsRemaining: null, dates: [], error: "No ODDS_API_KEY set in .env" };
  }
  const toSlate = options.toSlate ?? ((iso: string) => toSlateDate(new Date(iso)));

  const result = await fetchPlayerProps(process.env.ODDS_API_KEY!, sport, {
    maxEvents: options.maxEvents ?? 10,
    slateDate: options.slateDate,
    toSlate,
    propTypes: options.propTypes,
  });
  await recordOddsCredits(result.status.remaining, result.status.used);

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
    where: {
      source: "The Odds API",
      sport,
      status: "pending",
      ...(options.slateDate ? { date: options.slateDate } : {}),
    },
  });

  const dates = new Set<string>();
  const rows = result.props.map((p) => {
    const date = toSlate(p.commenceTime);
    dates.add(date);
    return {
      date,
      sport,
      league: p.league || sport,
      playerName: p.playerName,
      team: p.homeTeam,
      opponent: p.awayTeam,
      gameId: options.gameIdResolver?.(p.homeTeam, p.awayTeam, p.commenceTime) ?? null,
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
