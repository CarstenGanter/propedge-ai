import type { RiskLevel } from "@/types";

/**
 * Map model signals to a risk tier. Higher volatility, sparser data and lower
 * confidence all push risk upward. This is intentionally conservative — the app
 * never implies certainty.
 */
export function deriveRiskLevel(
  confidenceScore: number,
  volatilityRatio: number, // stddev / line, 0 = perfectly stable
  completeness: number, // 0..1 share of categories backed by real data
): RiskLevel {
  let points = 0;

  // Confidence is the primary driver — it already reflects hit rate vs the line.
  if (confidenceScore < 58) points += 2;
  else if (confidenceScore < 66) points += 1;

  // Sparse research data raises risk.
  if (completeness < 0.4) points += 2;
  else if (completeness < 0.7) points += 1;

  // Only extreme raw volatility adds risk (avoids double-penalizing low-line props,
  // whose variance is already captured by the confidence score).
  if (volatilityRatio > 0.6) points += 1;

  let level: RiskLevel = points >= 4 ? "High" : points >= 2 ? "Medium" : "Low";

  // Never label a pick "Low" risk without fairly complete research.
  if (level === "Low" && completeness < 0.6) level = "Medium";

  return level;
}

const RISK_STAKE_FACTOR: Record<RiskLevel, number> = {
  Low: 1,
  Medium: 0.75,
  High: 0.5,
};

/**
 * Suggested (informational) stake. Never a directive — the user's configured
 * default stake scaled down for riskier picks, rounded to a friendly increment.
 */
export function recommendedStake(risk: RiskLevel, defaultStake: number): number {
  const raw = defaultStake * RISK_STAKE_FACTOR[risk];
  return Math.max(1, Math.round(raw * 4) / 4);
}

export type ConfidenceTier =
  | "90-100"
  | "80-89"
  | "70-79"
  | "60-69"
  | "Below 60";

export const CONFIDENCE_TIERS: ConfidenceTier[] = [
  "90-100",
  "80-89",
  "70-79",
  "60-69",
  "Below 60",
];

export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  return "Below 60";
}
