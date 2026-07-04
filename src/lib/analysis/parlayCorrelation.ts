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
        const sameSide = a.direction === b.direction;
        pairs.push({
          a: label(a),
          b: label(b),
          level: sameSide ? "medium" : "low",
          reason: sameSide
            ? "Same game, same direction — outcomes tend to move together (game script)."
            : "Same game, opposite directions — mild correlation.",
        });
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
      "Multiple same-game legs detected. Correlated parlays can boost upside but raise the chance all legs miss together.",
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
