import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { recordOddsCredits } from "@/lib/providerCache";
import { toSlateDate } from "@/lib/utils/dates";
import type { Sport } from "@/types";
import { planIngest, propKey, refreshableFields } from "@/lib/ingestMerge";
import { parseSnapshot, snapshotFrom } from "@/lib/marketSnapshot";
import { mergeAvailability, mergeUnderdogLine } from "@/lib/analysis/venues";

export interface OddsIngestResult {
  ok: boolean;
  sport: string;
  imported: number;
  /** Props refreshed in place (user data on them kept). */
  updated?: number;
  created?: number;
  /** Props no longer offered by any book, with nothing depending on them. */
  removed?: number;
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
 * Merges into the pending Odds-API props already stored for that sport (and
 * slate date, when given): a prop still offered is updated in place, a new one
 * is created, and one no longer offered is removed only if nothing depends on
 * it. See ingestMerge.ts for why this is not a delete-and-recreate. Does NOT
 * revalidate or generate — callers do that.
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
      marketDataJson: JSON.stringify(snapshotFrom(p)),
      isDemo: false,
      feedUnderdogLine: p.venues?.underdog,
    };
  });

  const stored = await prisma.playerProp.findMany({
    where: {
      source: "The Odds API",
      sport,
      status: "pending",
      ...(options.slateDate ? { date: options.slateDate } : {}),
    },
    select: {
      id: true, date: true, playerName: true, propType: true, gameId: true, team: true, opponent: true,
      underdogLine: true, underdogAvailable: true, marketDataJson: true,
      _count: { select: { picks: true } },
    },
  });
  const storedById = new Map(stored.map((s) => [s.id, s]));

  /** Underdog line + availability after merging the feed, and the snapshot recording the source. */
  const withUnderdog = (row: (typeof rows)[number], prev?: (typeof stored)[number], hasPick = false) => {
    const { feedUnderdogLine, ...data } = row;
    const prevSource = parseSnapshot(prev?.marketDataJson)?.underdogLineSource ?? null;
    // Once a prop has a pick, its Underdog line may have been played: the feed
    // can fill a blank but never move it, or settlement would grade the bet at
    // a line that was never bet.
    const feed = hasPick && prev?.underdogLine != null ? undefined : feedUnderdogLine;
    const merged = mergeUnderdogLine({ line: prev?.underdogLine ?? null, source: prevSource }, feed);
    const snap = JSON.parse(data.marketDataJson);
    if (merged.source) snap.underdogLineSource = merged.source;
    return {
      ...data,
      marketDataJson: JSON.stringify(snap),
      underdogLine: merged.line,
      underdogAvailable: mergeAvailability(prev?.underdogAvailable ?? null, feedUnderdogLine),
    };
  };
  const byKey = new Map(rows.map((r) => [propKey(r), r]));
  const plan = planIngest(
    stored.map((s) => ({ id: s.id, key: propKey(s), hasPick: s._count.picks > 0 })),
    [...byKey.keys()],
  );

  // Update in place. The user's Underdog line, payout and availability, picks,
  // slip legs and closing lines all live on or under these rows and survive.
  for (const [key, { id, hasPick }] of plan.update) {
    await prisma.playerProp.update({
      where: { id },
      data: refreshableFields(withUnderdog(byKey.get(key)!, storedById.get(id), hasPick), hasPick),
    });
  }
  if (plan.create.length > 0) {
    await prisma.playerProp.createMany({ data: plan.create.map((k) => withUnderdog(byKey.get(k)!)) });
  }
  if (plan.remove.length > 0) {
    await prisma.playerProp.deleteMany({ where: { id: { in: plan.remove } } });
  }

  return {
    ok: true,
    sport,
    imported: rows.length,
    updated: plan.update.size,
    created: plan.create.length,
    removed: plan.remove.length,
    events: result.events,
    creditsRemaining: result.status.remaining,
    dates: [...dates],
  };
}
