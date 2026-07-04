import type { ScorablePropInput, SentimentContext } from "@/types";
import { demoSentiment } from "./demoData";
import type { ProviderContext } from "./config";
import { hasKey } from "./config";

/** Expert/market sentiment provider (SEARCH_API_KEY / Reddit plug in later). */
export interface SentimentProvider {
  getSentiment(prop: ScorablePropInput): Promise<SentimentContext | undefined>;
}

export const demoSentimentProvider: SentimentProvider = {
  async getSentiment(prop) {
    return demoSentiment(prop);
  },
};

export const liveSentimentProvider: SentimentProvider = {
  async getSentiment() {
    if (!hasKey("SEARCH_API_KEY")) return undefined;
    // Seam for a real web-search / social sentiment integration. Credible
    // sources should be weighted above anonymous posts when implemented.
    return undefined;
  },
};

export function getSentimentProvider(ctx: ProviderContext): SentimentProvider {
  return ctx.demo ? demoSentimentProvider : liveSentimentProvider;
}
