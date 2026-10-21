import "server-only";
import { prisma } from "@/lib/db/client";
import { fetchPlayerProps } from "@/lib/providers/live/theOddsApi";
import { hasKey } from "@/lib/providers/config";
import { recordOddsCredits } from "@/lib/providerCache";
import { toSlateDate } from "@/lib/utils/dates";
import type { Sport } from "@/types";
import { planIngest, propKey, refreshableFields } from "@/lib/ingestMerge";
import { parseSnapshot, snapshotFrom } from "@/lib/marketSnapshot";
import { mergeAvailability, mergeUnderdogLine, underdogPricesLookReal } from "@/lib/analysis/venues";
import { saveQuotes } from "@/lib/oddsStore";
import { teamsMatch } from "@/lib/utils/teamName";

export interface OddsIngestResult {
  ok: boolean;
  sport: string;
  imported: number;
  /** Props refreshed in place (user data on them kept). */
  updated?: number;
  created?: number;
  /** Props no longer offered in a game this fetch priced, marked withdrawn (never deleted). */
  withdrawn?: number;
  events: number;
  creditsRemaining: number | null;
  dates: string[];
  /** Underdog's prices varied instead of the usual one placeholder — possibly real payouts. Null: none in the feed. */
  underdogPricesReal?: boolean | null;
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
 * slate date, when given): a prop still offered is updated in place (and
 * revived if it had been withdrawn), a new one is created, and one no longer
 * offered in a game this fetch priced is marked withdrawn if nothing depends on
 * it. See ingestMerge.ts for why nothing is deleted. Does NOT revalidate or
 * generate — callers do that.
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
  // When these quotes were fetched: the odds store and any forecast logged from them are as of this time.
  const fetchedAtDate = new Date();
  await saveQuotes(result.quotes, fetchedAtDate, "slate");

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
  const fetchedAt = fetchedAtDate.toISOString();
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
      marketDataJson: JSON.stringify({ ...snapshotFrom(p), fetchedAt }),
      isDemo: false,
      feedUnderdogLine: p.venues?.underdog,
    };
  });

  const stored = await prisma.playerProp.findMany({
    where: {
      source: "The Odds API",
      sport,
      status: { in: ["pending", "withdrawn"] },
      ...(options.slateDate ? { date: options.slateDate } : {}),
    },
    select: {
      id: true, date: true, status: true, playerName: true, propType: true, gameId: true, team: true, opponent: true,
      underdogLine: true, underdogAvailable: true, underdogPickMultiplier: true, marketDataJson: true,
      // Only a pick you bet (placed, or in a saved slip) locks the prop's line
      // and side. Auto-generated board picks are rebuilt by the re-rank anyway.
      _count: { select: { picks: { where: { OR: [{ placedReal: true }, { parlayLegs: { some: {} } }] } } } },
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
  // Odds API props store the home side as `team`.
  const priced = (s: (typeof stored)[number]) =>
    result.pricedEvents.some((e) => teamsMatch(e.home, s.team) && teamsMatch(e.away, s.opponent));
  const plan = planIngest(
    stored.map((s) => ({ id: s.id, key: propKey(s), hasPick: s._count.picks > 0, priced: priced(s), withdrawn: s.status === "withdrawn" })),
    [...byKey.keys()],
  );

  // Update in place. The user's Underdog line, payout and availability, picks,
  // slip legs and closing lines all live on or under these rows and survive.
  for (const [key, { id, hasPick }] of plan.update) {
    const prev = storedById.get(id);
    const data: Record<string, unknown> = refreshableFields(withUnderdog(byKey.get(key)!, prev, hasPick), hasPick);
    // A payout you typed belongs to the side shown when you typed it.
    if (prev?.underdogPickMultiplier != null) delete data.direction;
    if (prev?.status === "withdrawn") data.status = "pending"; // re-offered
    await prisma.playerProp.update({ where: { id }, data });
  }
  if (plan.create.length > 0) {
    await prisma.playerProp.createMany({ data: plan.create.map((k) => withUnderdog(byKey.get(k)!)) });
  }
  if (plan.withdraw.length > 0) {
    // Off the board: the prop's unplaced board picks go (the re-rank rebuilds
    // the board anyway), while the prop row, its grade and its logged
    // forecasts stay for research.
    await prisma.pick.deleteMany({
      where: { playerPropId: { in: plan.withdraw }, status: "pending", placedReal: false, parlayLegs: { none: {} } },
    });
    await prisma.playerProp.updateMany({ where: { id: { in: plan.withdraw } }, data: { status: "withdrawn" } });
  }

  return {
    ok: true,
    sport,
    imported: rows.length,
    updated: plan.update.size,
    created: plan.create.length,
    withdrawn: plan.withdraw.length,
    events: result.events,
    creditsRemaining: result.status.remaining,
    dates: [...dates],
    underdogPricesReal: underdogPricesLookReal(result.props.flatMap((p) => p.quotes ?? [])),
    // Some games failed even though others came back: say so.
    ...(result.status.error ? { error: `partial fetch: ${result.status.error}` } : {}),
  };
}
