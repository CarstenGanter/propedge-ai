import type { Direction } from "@/types";
import { positionFamilyForProp } from "./slate";

/**
 * Game environment for an NFL prop: the posted total and the spread-implied
 * game script, resolved into a single direction-aware nudge (pure, tested).
 *
 * Two effects, both well established in football:
 *  - **Total.** More expected points means more plays and more yardage to go
 *    around, which helps Overs and hurts Unders.
 *  - **Script.** A team trailing throws to catch up, so underdog passing games
 *    see more volume; a favorite protects a lead on the ground, so favoured
 *    rushing games see more carries.
 *
 * Combined yardage props (rush + receive) are treated as script-neutral: when a
 * back's team trails he catches more passes, and when it leads he runs more, so
 * the two effects largely cancel.
 */

/** Rough league-average posted total; the neutral point for the total effect. */
export const NEUTRAL_TOTAL = 44.5;
/** Spread at which the total/script effect saturates. */
export const SPREAD_SCALE = 10;
/** |spread| at or above this flags blowout / garbage-time risk. */
export const BLOWOUT_SPREAD = 10;

const TOTAL_WEIGHT = 0.6;
const SCRIPT_WEIGHT = 0.4;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export interface GameEnvironmentInput {
  propType: string;
  direction: Direction;
  /** Posted over/under for the game. */
  gameTotal?: number | null;
  /** The player's own team handicap: negative = favored, positive = underdog. */
  teamSpread?: number | null;
}

export interface GameEnvironment {
  /** -1..1, already signed for the pick's direction. */
  favor: number;
  note: string;
  blowoutRisk: boolean;
}

export function gameEnvironmentFavor(input: GameEnvironmentInput): GameEnvironment | null {
  const { propType, direction } = input;
  const total = input.gameTotal ?? null;
  const spread = input.teamSpread ?? null;
  if (total == null && spread == null) return null;

  const family = positionFamilyForProp(propType);
  const parts: string[] = [];
  let raw = 0;
  let weight = 0;

  if (total != null) {
    const totalFavor = clamp((total - NEUTRAL_TOTAL) / SPREAD_SCALE, -1, 1);
    raw += TOTAL_WEIGHT * totalFavor;
    weight += TOTAL_WEIGHT;
    const word = total >= NEUTRAL_TOTAL + 3 ? "high-scoring" : total <= NEUTRAL_TOTAL - 3 ? "low-scoring" : "average";
    parts.push(`Posted total ${total} (${word} environment).`);
  }

  if (spread != null) {
    // Positive spread = this player's team is the underdog.
    let scriptFavor = 0;
    if (family === "pass" || family === "rec") {
      scriptFavor = clamp(spread / SPREAD_SCALE, -1, 1); // trailing teams throw
    } else if (family === "rush") {
      scriptFavor = clamp(-spread / SPREAD_SCALE, -1, 1); // leading teams run
    }
    if (family === "combo") {
      parts.push(`Team ${fmt(spread)} (combined yardage is largely script-neutral).`);
    } else if (scriptFavor !== 0) {
      raw += SCRIPT_WEIGHT * scriptFavor;
      weight += SCRIPT_WEIGHT;
      const side = spread > 0 ? "underdog" : "favorite";
      const implies =
        family === "rush"
          ? spread < 0
            ? "more clock-killing carries"
            : "fewer carries if they trail"
          : spread > 0
            ? "more throwing to catch up"
            : "less need to throw";
      parts.push(`Team ${fmt(spread)} (${side}) — ${implies}.`);
    } else {
      parts.push(`Team ${fmt(spread)}.`);
    }
  }

  // Renormalize so a missing piece doesn't mute the one we have.
  const normalized = weight > 0 ? raw / weight : 0;
  const favor = clamp(direction === "OVER" ? normalized : -normalized, -1, 1);
  const blowoutRisk = spread != null && Math.abs(spread) >= BLOWOUT_SPREAD;
  if (blowoutRisk) {
    parts.push("Lopsided spread — blowout/garbage-time risk cuts both ways for volume.");
  }

  return { favor: Math.round(favor * 1000) / 1000, note: parts.join(" "), blowoutRisk };
}
