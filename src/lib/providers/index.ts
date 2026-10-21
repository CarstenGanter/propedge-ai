import type { ResearchBundle, ScorablePropInput } from "@/types";
import { demoHistorical } from "./demoData";
import { getStatsProvider } from "./sportsStatsProvider";
import { getNewsProvider } from "./newsProvider";
import { getOddsProvider } from "./oddsProvider";
import { getSentimentProvider } from "./sentimentProvider";
import { DEMO_RESULT_SOURCE, getResultsProvider, type ResultLookup } from "./resultsProvider";
import { getLiveHistorical } from "./historicalProvider";
import type { ProviderContext } from "./config";

export * from "./config";
export { underdogProvider } from "./underdogProvider";

/** Decide whether research should be demo (deterministic) or live. */
export function resolveProviderContext(opts: {
  propIsDemo?: boolean;
  demoMode: boolean;
  enableWebResearch: boolean;
}): ProviderContext {
  return {
    demo: Boolean(opts.propIsDemo) || opts.demoMode,
    enableWebResearch: opts.enableWebResearch,
  };
}

/**
 * The context for settling one pick. Demo is decided by the pick alone: the
 * global demo switch makes research deterministic, but must never grade a real
 * pick with a synthetic result (the schema default for the switch is on, so a
 * recreated settings row would otherwise do exactly that).
 */
export function settlementContext(pick: { isDemo: boolean }, settings: { enableWebResearch: boolean }): ProviderContext {
  return { demo: pick.isDemo, enableWebResearch: settings.enableWebResearch };
}

/**
 * A lookup that may settle this pick: resolved, with a value, and never a
 * synthetic demo result on a real pick — whatever context produced it.
 */
export function usableResult(pick: { isDemo: boolean }, lookup: ResultLookup): lookup is ResultLookup & { actualResult: number } {
  if (!lookup.resolved || lookup.actualResult == null) return false;
  return pick.isDemo || lookup.source !== DEMO_RESULT_SOURCE;
}

/** Assemble a full research bundle for a prop from all configured providers. */
export async function buildResearchBundle(
  prop: ScorablePropInput,
  ctx: ProviderContext,
): Promise<ResearchBundle> {
  const stats = getStatsProvider(ctx);
  const news = getNewsProvider(ctx);
  const odds = getOddsProvider(ctx);
  const sentiment = getSentimentProvider(ctx);

  const [playerStats, matchup, newsCtx, market, sentimentCtx, historicalLive] = await Promise.all([
    stats.getPlayerStats(prop).catch(() => undefined),
    stats.getMatchup(prop).catch(() => undefined),
    news.getNews(prop).catch(() => undefined),
    odds.getMarket(prop).catch(() => undefined),
    sentiment.getSentiment(prop).catch(() => undefined),
    ctx.demo ? Promise.resolve(undefined) : getLiveHistorical(prop).catch(() => undefined),
  ]);

  const historical = ctx.demo ? demoHistorical(prop) : historicalLive;

  return {
    playerStats,
    matchup,
    news: newsCtx,
    market,
    sentiment: sentimentCtx,
    historical,
  };
}

/** Look up an actual result for settlement via the appropriate provider. */
export async function lookupResult(
  prop: ScorablePropInput & { date: string },
  ctx: ProviderContext,
): Promise<ResultLookup> {
  // Live lookups only when explicitly enabled; otherwise require manual settlement.
  if (!ctx.demo && !ctx.enableWebResearch) {
    return {
      actualResult: null,
      source: "manual",
      resolved: false,
      note: "Live research disabled — enter the result manually.",
    };
  }
  return getResultsProvider(ctx).getActualResult(prop);
}
