import type { MarketContext, ScorablePropInput } from "@/types";
import { demoMarket } from "./demoData";
import type { ProviderContext } from "./config";
import { hasKey } from "./config";

/** Market / projection provider (The Odds API key plugs in later). */
export interface OddsProvider {
  getMarket(prop: ScorablePropInput): Promise<MarketContext | undefined>;
}

export const demoOddsProvider: OddsProvider = {
  async getMarket(prop) {
    return demoMarket(prop);
  },
};

/**
 * Live market. Prefers the market snapshot stored on the prop at ingestion time
 * (from The Odds API) so no extra API credits are spent during analysis. Falls
 * back to a manually-entered projection.
 */
export const liveOddsProvider: OddsProvider = {
  async getMarket(prop) {
    if (prop.marketDataJson) {
      try {
        const m = JSON.parse(prop.marketDataJson) as MarketContext;
        // The prop's original line is the market line — use it as a fallback so
        // scoring a different (Underdog) line correctly detects the difference.
        return {
          ...m,
          marketLine: m.marketLine ?? prop.marketLine ?? undefined,
          source: m.source ?? "The Odds API",
        };
      } catch {
        // fall through to projection
      }
    }
    if (prop.projection != null) {
      return { projection: prop.projection, source: "manual entry" };
    }
    if (!hasKey("ODDS_API_KEY")) return undefined;
    // Per-prop live fetch is intentionally avoided here to conserve API credits;
    // props ingested via The Odds API already carry their market snapshot.
    return undefined;
  },
};

export function getOddsProvider(ctx: ProviderContext): OddsProvider {
  return ctx.demo ? demoOddsProvider : liveOddsProvider;
}
