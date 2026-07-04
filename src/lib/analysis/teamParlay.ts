import type { RiskLevel, TeamSide, TeamStatus } from "@/types";
import type { BankrollResult } from "@/lib/settlement";

/**
 * Moneyline (team-to-win) parlay math & analysis. Unlike prop parlays — which
 * use a manual payout multiplier — a moneyline parlay's payout is fully
 * determined by each leg's American price: multiply the legs' decimal odds.
 * Everything here is pure and deterministic.
 */

/** American odds → decimal odds (total return per 1 unit staked, incl. stake). */
export function americanToDecimal(price: number): number {
  return price > 0 ? price / 100 + 1 : 100 / Math.abs(price) + 1;
}

/** Decimal odds → the nearest American price (for display). */
export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return -100000;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}

export interface TeamParlayLegInput {
  teamPickId: string;
  recommendedTeam: string;
  opponent: string;
  side: TeamSide;
  league: string;
  gameId?: string | null;
  priceAmerican?: number | null;
  winProbability: number; // model, 0..1
  confidenceScore: number;
  riskLevel: RiskLevel;
  drawProbability?: number | null; // soccer
}

/** Combined decimal/American odds + projected payout for a set of moneyline legs. */
export function teamParlayOdds(
  legs: { priceAmerican?: number | null }[],
  stake: number,
): { combinedDecimal: number; combinedAmerican: number; projectedPayout: number; profitIfWon: number } {
  const combinedDecimal = legs.reduce(
    (acc, l) => acc * americanToDecimal(l.priceAmerican ?? 100), // even-money fallback when price unknown
    1,
  );
  const projectedPayout = round2(stake * combinedDecimal);
  return {
    combinedDecimal: round4(combinedDecimal),
    combinedAmerican: decimalToAmerican(combinedDecimal),
    projectedPayout,
    profitIfWon: round2(projectedPayout - stake),
  };
}

export interface TeamParlayAnalysis {
  legCount: number;
  combinedHitEstimate: number; // product of model win probabilities (independent estimate)
  averageConfidence: number;
  combinedRisk: RiskLevel;
  warnings: string[];
  suggestions: string[];
}

export function analyzeTeamParlay(legs: TeamParlayLegInput[]): TeamParlayAnalysis {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Two legs from the same game can't both win a moneyline — flag it hard.
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const sameGame =
        (a.gameId && b.gameId && a.gameId === b.gameId) ||
        (a.recommendedTeam === b.opponent && b.recommendedTeam === a.opponent);
      if (sameGame) {
        warnings.push(
          `${a.recommendedTeam} and ${b.recommendedTeam} look like the same game — a moneyline parlay can't win both sides.`,
        );
      }
    }
  }

  const drawRiskLegs = legs.filter((l) => (l.drawProbability ?? 0) >= 0.28);
  if (drawRiskLegs.length > 0) {
    warnings.push(
      `${drawRiskLegs.length} soccer leg(s) carry real draw risk — a draw loses that leg and sinks the whole parlay.`,
    );
  }

  const averageConfidence =
    legs.length === 0 ? 0 : Math.round(legs.reduce((s, l) => s + l.confidenceScore, 0) / legs.length);

  const combinedHitEstimate = legs.reduce((p, l) => p * clamp01(l.winProbability), 1);

  const highRiskLegs = legs.filter((l) => l.riskLevel === "High").length;
  let combinedRisk: RiskLevel = "Low";
  if (legs.length >= 4 || highRiskLegs >= 2 || warnings.length > 0) combinedRisk = "High";
  else if (legs.length >= 3 || highRiskLegs >= 1) combinedRisk = "Medium";

  if (legs.length >= 4) {
    suggestions.push("4+ leg parlays win rarely. Trim to your highest-confidence sides.");
  }
  if (legs.length > 0 && combinedHitEstimate < 0.15) {
    suggestions.push(
      `Model estimate of all legs winning is ~${(combinedHitEstimate * 100).toFixed(0)}% — a low-probability, high-variance play.`,
    );
  }

  return {
    legCount: legs.length,
    combinedHitEstimate,
    averageConfidence,
    combinedRisk,
    warnings,
    suggestions,
  };
}

/**
 * Settle a team moneyline parlay from its legs' outcomes and prices.
 * - any leg loss => lost (−stake)
 * - push/void legs are removed and the combined odds recomputed from survivors
 * - all survivors win => won, paid at the recomputed decimal odds
 */
export function settleTeamParlay(
  stake: number,
  legs: { status: TeamStatus; priceAmerican?: number | null }[],
): BankrollResult {
  if (legs.length === 0 || legs.some((l) => l.status === "pending")) {
    return { stake, payout: 0, profitLoss: 0, status: "pending" };
  }
  if (legs.some((l) => l.status === "loss")) {
    return { stake, payout: 0, profitLoss: round2(-stake), status: "lost" };
  }
  const winners = legs.filter((l) => l.status === "win");
  if (winners.length === 0) {
    // every leg pushed/voided → stake returned
    return { stake, payout: stake, profitLoss: 0, status: "void" };
  }
  const decimal = winners.reduce((acc, l) => acc * americanToDecimal(l.priceAmerican ?? 100), 1);
  const payout = round2(stake * decimal);
  return { stake, payout, profitLoss: round2(payout - stake), status: "won" };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
