import type { ScorablePropInput } from "@/types";
import { demoActualResult } from "./demoData";
import type { ProviderContext } from "./config";
import { espnSupportsSport, fetchPlayerGameStat, findEvent } from "./live/espn";
import { getMlbResult } from "./live/mlbStats";

export interface ResultLookup {
  actualResult: number | null;
  source: string;
  /** True when a definitive final stat was found; false => manual settlement. */
  resolved: boolean;
  note?: string;
}

export interface ResultsProvider {
  getActualResult(
    prop: ScorablePropInput & { date: string },
  ): Promise<ResultLookup>;
}

/** Demo settlement uses deterministic synthetic results so the flow is testable. */
export const demoResultsProvider: ResultsProvider = {
  async getActualResult(prop) {
    return {
      actualResult: demoActualResult(prop),
      source: "Demo data",
      resolved: true,
      note: "Synthetic demo result — not a real box score.",
    };
  },
};

/** Live settlement via ESPN box scores; returns unresolved when it can't confirm. */
export const liveResultsProvider: ResultsProvider = {
  async getActualResult(prop) {
    // MLB: reliable settlement via MLB Stats API dated game logs.
    if (prop.sport === "MLB") {
      try {
        const r = await getMlbResult(prop.playerName, prop.propType, prop.date);
        if (r != null) {
          return { actualResult: r, source: "MLB Stats API box score", resolved: true };
        }
        return {
          actualResult: null,
          source: "MLB Stats API",
          resolved: false,
          note: "Game not final yet or player did not appear — settle manually.",
        };
      } catch {
        return {
          actualResult: null,
          source: "MLB Stats API",
          resolved: false,
          note: "Live lookup failed — settle manually.",
        };
      }
    }

    if (!espnSupportsSport(prop.sport)) {
      return {
        actualResult: null,
        source: "unavailable",
        resolved: false,
        note: "Sport not supported by the live provider — settle manually.",
      };
    }
    try {
      const dateCompact = prop.date.replace(/-/g, "");
      const event = await findEvent(prop.sport, dateCompact, prop.team, prop.opponent, prop.league);
      if (!event) {
        return {
          actualResult: null,
          source: "ESPN",
          resolved: false,
          note: "Could not match the game on ESPN — settle manually.",
        };
      }
      if (!event.completed) {
        return {
          actualResult: null,
          source: "ESPN",
          resolved: false,
          note: "Game not final yet — settle after it completes.",
        };
      }
      const stat = await fetchPlayerGameStat(
        prop.sport,
        event.eventId,
        prop.playerName,
        prop.propType,
        prop.league,
      );
      if (stat == null) {
        return {
          actualResult: null,
          source: "ESPN",
          resolved: false,
          note: "Game final, but this stat/player could not be parsed — settle manually.",
        };
      }
      return { actualResult: stat, source: "ESPN box score", resolved: true };
    } catch {
      return {
        actualResult: null,
        source: "ESPN",
        resolved: false,
        note: "Live lookup failed — settle manually.",
      };
    }
  },
};

export function getResultsProvider(ctx: ProviderContext): ResultsProvider {
  return ctx.demo ? demoResultsProvider : liveResultsProvider;
}
