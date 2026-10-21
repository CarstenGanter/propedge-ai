import type { ScorablePropInput } from "@/types";
import { demoActualResult } from "./demoData";
import type { ProviderContext } from "./config";
import { espnGradesProp, espnSupportsSport, fetchPlayerGameStat, findEvent, type BoxStat } from "./live/espn";
import { getMlbResult } from "./live/mlbStats";

export interface ResultLookup {
  actualResult: number | null;
  source: string;
  /** True when a definitive final stat was found; false => manual settlement. */
  resolved: boolean;
  note?: string;
  /** The game is final but the player is in no section of its box score. */
  absentFromBoxScore?: boolean;
}

export interface ResultsProvider {
  getActualResult(
    prop: ScorablePropInput & { date: string },
  ): Promise<ResultLookup>;
}

/** The source every synthetic result carries — never a real grade. */
export const DEMO_RESULT_SOURCE = "Demo data";

/** Demo settlement uses deterministic synthetic results so the flow is testable. */
export const demoResultsProvider: ResultsProvider = {
  async getActualResult(prop) {
    return {
      actualResult: demoActualResult(prop),
      source: DEMO_RESULT_SOURCE,
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
    if (!espnGradesProp(prop.sport, prop.propType, prop.league)) {
      return {
        actualResult: null,
        source: "ESPN",
        resolved: false,
        note: `ESPN settlement can't grade ${prop.propType} for ${prop.sport} — settle manually.`,
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
      return lookupFromBoxStat(await fetchPlayerGameStat(prop.sport, event.eventId, prop.playerName, prop.propType, prop.league));
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

/**
 * A box-score reading as a settlement lookup (pure). Only a player the final
 * box score lists nowhere is "absent" — the one case the NFL snap-count
 * fallback may settle. A failed fetch, a name two players share, or a stat
 * that can't be read each say so and go to manual settlement.
 */
export function lookupFromBoxStat(b: BoxStat): ResultLookup {
  switch (b.kind) {
    case "stat":
      return { actualResult: b.value, source: "ESPN box score", resolved: true };
    case "absent":
      return {
        actualResult: null,
        source: "ESPN",
        resolved: false,
        absentFromBoxScore: true,
        note: "Game is final but this player recorded nothing anywhere in the box score — they were likely inactive or did not take the field. Settle manually.",
      };
    case "ambiguous":
      return { actualResult: null, source: "ESPN", resolved: false, note: "More than one player in the ESPN box score matches this name — settle manually." };
    case "unreadable":
      return { actualResult: null, source: "ESPN", resolved: false, note: `The ESPN box score lists the player but the stat can't be read (${b.reason}) — settle manually.` };
    case "unavailable":
      return { actualResult: null, source: "ESPN", resolved: false, note: `${b.reason[0].toUpperCase()}${b.reason.slice(1)} — retried later, or settle manually.` };
  }
}
