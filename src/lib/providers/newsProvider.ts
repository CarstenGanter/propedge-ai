import type { NewsContext, ScorablePropInput } from "@/types";
import { demoNews } from "./demoData";
import { getMlbNews } from "./live/mlbNews";
import { fetchLeagueInjuries } from "./live/espnInjuries";
import { espnPathForSport, nameMatches } from "./live/espn";
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

    // NFL: official game injury report + RotoWire note + headlines (free, sourced).
    if (prop.sport === "NFL") {
      const { getNflNews } = await import("./live/nflNews"); // server-only deps → lazy
      const nfl = await getNflNews(prop).catch(() => undefined);
      if (nfl) return nfl;
    }

    // Non-MLB: match the player against ESPN's league injury feed (free).
    const path = espnPathForSport(prop.sport, prop.league);
    if (path && prop.sport !== "MLB") {
      const injuries = await fetchLeagueInjuries(path.sport, path.league).catch(() => []);
      const hit = injuries.find((e) => nameMatches(e.playerName, prop.playerName));
      if (hit) {
        // "active" isn't a listed injury — treat as no news rather than a false clean bill.
        const status = hit.status === "active" ? undefined : hit.status;
        return {
          playerStatus: status,
          source: "ESPN injuries",
          notes: [{ summary: hit.detail, sourceName: "ESPN" }],
        };
      }
      // Absence from the list is not proof of health — fall through to undefined.
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
