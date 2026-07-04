import type { ResearchBundle, ScorablePropInput } from "@/types";
import { demoHistorical } from "./demoData";
import { getStatsProvider } from "./sportsStatsProvider";
import { getNewsProvider } from "./newsProvider";
import { getOddsProvider } from "./oddsProvider";
import { getSentimentProvider } from "./sentimentProvider";
import { getResultsProvider, type ResultLookup } from "./resultsProvider";
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

/** Assemble a full research bundle for a prop from all configured providers. */
export async function buildResearchBundle(
  prop: ScorablePropInput,
  ctx: ProviderContext,
): Promise<ResearchBundle> {
  const stats = getStatsProvider(ctx);
  const news = getNewsProvider(ctx);
  const odds = getOddsProvider(ctx);
  const sentiment = getSentimentProvider(ctx);

  const [playerStats, matchup, newsCtx, market, sentimentCtx] = await Promise.all([
    stats.getPlayerStats(prop).catch(() => undefined),
    stats.getMatchup(prop).catch(() => undefined),
    news.getNews(prop).catch(() => undefined),
    odds.getMarket(prop).catch(() => undefined),
    sentiment.getSentiment(prop).catch(() => undefined),
  ]);

  const historical = ctx.demo ? demoHistorical(prop) : undefined;

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
