import type { Direction, RiskLevel } from "@/types";

export interface ParlayLegInput {
  pickId: string;
  playerName: string;
  team: string;
  opponent: string;
  gameKey: string; // normalized identifier for the game
  propType: string;
  direction: Direction;
  confidenceScore: number;
  riskLevel: RiskLevel;
  /** The player's own team, when resolved — distinguishes team-mates from opponents. */
  teamId?: string | null;
}

export interface CorrelationPair {
  a: string; // playerName + prop
  b: string;
  level: "high" | "medium" | "low";
  reason: string;
}

export interface ParlayAnalysis {
  legCount: number;
  /** Rough independent estimate that ALL legs hit (model estimate, not a guarantee). */
  combinedHitEstimate: number; // 0..1
  averageConfidence: number;
  combinedRisk: RiskLevel;
  correlationPairs: CorrelationPair[];
  warnings: string[];
  suggestions: string[];
}

/** Build a stable game key from two team names + date so leg ordering doesn't matter. */
export function makeGameKey(team: string, opponent: string, date: string): string {
  return [team.trim().toLowerCase(), opponent.trim().toLowerCase()]
    .sort()
    .concat(date)
    .join("|");
}

const label = (l: ParlayLegInput) => `${l.playerName} (${l.direction} ${l.propType})`;

export function analyzeParlay(legs: ParlayLegInput[]): ParlayAnalysis {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.playerName.toLowerCase() === b.playerName.toLowerCase()) {
        pairs.push({
          a: label(a),
          b: label(b),
          level: "high",
          reason: "Same player on multiple legs — highly correlated outcomes.",
        });
      } else if (a.gameKey === b.gameKey) {
        // Measured on nflverse weekly data, 2022-2024: team-mates sharing a
        // quarterback move together (+0.34), but two players on opposing teams
        // in the same game barely do (+0.04) — close enough to independent that
        // calling it "correlated" overstates the link.
        const teammates = Boolean(a.teamId && b.teamId && a.teamId === b.teamId);
        const sameSide = a.direction === b.direction;
        if (teammates && sameSide) {
          pairs.push({
            a: label(a),
            b: label(b),
            level: "medium",
            reason:
              "Same team, same direction — outcomes move together (measured correlation about +0.34 " +
              "for a passer and his receiver). On a fixed-multiplier pick'em that raises the chance " +
              "the slip lands; against a true-odds parlay it is priced in.",
          });
        } else {
          pairs.push({
            a: label(a),
            b: label(b),
            level: "low",
            reason: sameSide
              ? "Same game, opposing teams — measured correlation about +0.04, effectively independent."
              : "Same game, opposite directions — mild negative link at most.",
          });
        }
      }
    }
  }

  const highCount = pairs.filter((p) => p.level === "high").length;
  const mediumCount = pairs.filter((p) => p.level === "medium").length;

  if (highCount > 0) {
    warnings.push(
      "Contains highly correlated legs (same player). If one misses, related legs often miss too — this concentrates risk.",
    );
  }
  if (mediumCount >= 2) {
    warnings.push(
      "Multiple correlated legs detected. On a fixed-multiplier pick'em that works in your favour — " +
        "the payout is priced as if the legs were independent, and missing one leg costs the same as " +
        "missing all of them. On a true-odds parlay the book prices the correlation and the edge is gone.",
    );
  }

  const averageConfidence =
    legs.length === 0
      ? 0
      : Math.round(
          legs.reduce((s, l) => s + l.confidenceScore, 0) / legs.length,
        );

  // Naive independent estimate; correlation is disclosed separately as a caveat.
  const combinedHitEstimate = legs.reduce(
    (p, l) => p * clamp01(l.confidenceScore / 100),
    1,
  );

  const highRiskLegs = legs.filter((l) => l.riskLevel === "High").length;
  let combinedRisk: RiskLevel = "Low";
  if (legs.length >= 4 || highRiskLegs >= 2 || highCount > 0) combinedRisk = "High";
  else if (legs.length >= 3 || highRiskLegs >= 1 || mediumCount >= 1) combinedRisk = "Medium";

  if (legs.length >= 5) {
    suggestions.push(
      "5+ leg parlays have low overall hit probability. Consider trimming to your highest-confidence legs.",
    );
  }
  if (highCount > 0) {
    suggestions.push("Consider replacing same-player legs with independent games to diversify.");
  }
  if (legs.length > 0 && combinedHitEstimate < 0.15) {
    suggestions.push(
      `Rough model estimate of all legs hitting is ~${(combinedHitEstimate * 100).toFixed(
        0,
      )}% — treat this as a low-probability, high-variance play.`,
    );
  }

  return {
    legCount: legs.length,
    combinedHitEstimate,
    averageConfidence,
    combinedRisk,
    correlationPairs: pairs,
    warnings,
    suggestions,
  };
}

/** Payout math for a manual-multiplier parlay. */
export function parlayPayout(stake: number, multiplier: number) {
  const projectedPayout = round2(stake * multiplier);
  const profitIfWon = round2(projectedPayout - stake);
  return { projectedPayout, profitIfWon, lossIfLost: round2(-stake) };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
