import type { NewsContext, ScorablePropInput } from "@/types";
import { demoNews } from "./demoData";
import { getMlbNews } from "./live/mlbNews";
import type { ProviderContext } from "./config";
import { hasKey } from "./config";

/** Injury / team-news provider. Real key (NEWS_API_KEY) plugs in later. */
export interface NewsProvider {
  getNews(prop: ScorablePropInput): Promise<NewsContext | undefined>;
}

export const demoNewsProvider: NewsProvider = {
  async getNews(prop) {
    return demoNews(prop);
  },
};

/**
 * Live news: no fabricated content. If a manual injuryStatus was entered on the
 * prop we surface exactly that; otherwise we return undefined (never invented).
 */
export const liveNewsProvider: NewsProvider = {
  async getNews(prop) {
    // MLB: free injured-list status + probable-starter confirmation.
    if (prop.sport === "MLB" && prop.date) {
      const mlb = await getMlbNews(prop.playerName, prop.propType, prop.date).catch(() => undefined);
      if (mlb) return mlb;
    }
    if (!hasKey("NEWS_API_KEY")) {
      if (prop.injuryStatus) {
        return {
          playerStatus: undefined,
          source: "manual entry",
          notes: [{ summary: `Manual injury note: ${prop.injuryStatus}`, sourceName: "manual entry" }],
        };
      }
      return undefined;
    }
    // Seam for a real News API integration.
    return undefined;
  },
};

export function getNewsProvider(ctx: ProviderContext): NewsProvider {
  return ctx.demo ? demoNewsProvider : liveNewsProvider;
}
