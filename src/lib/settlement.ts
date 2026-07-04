import type { Direction, SettlementStatus, TeamStatus, WagerStatus } from "@/types";

/**
 * Determine hit/miss/push from an actual stat result vs the line & direction.
 * Returns "pending" when the result is unknown.
 */
export function settleProp(
  line: number,
  direction: Direction,
  actualResult: number | null | undefined,
): SettlementStatus {
  if (actualResult == null || Number.isNaN(actualResult)) return "pending";
  if (actualResult === line) return "push";
  const over = actualResult > line;
  const isHit = direction === "OVER" ? over : !over;
  return isHit ? "hit" : "miss";
}

export function settlementToWager(status: SettlementStatus): WagerStatus {
  switch (status) {
    case "hit":
      return "won";
    case "miss":
      return "lost";
    case "push":
      return "push";
    case "void":
      return "void";
    default:
      return "pending";
  }
}

export interface BankrollResult {
  stake: number;
  payout: number;
  profitLoss: number;
  status: WagerStatus;
}

/**
 * P/L for a single-pick entry. Underdog does not offer true singles, so for
 * simulation we default to even money (2x) unless a payout multiplier is set.
 */
export function settleSingle(
  stake: number,
  settlement: SettlementStatus,
  payoutMultiplier = 2,
): BankrollResult {
  const status = settlementToWager(settlement);
  switch (status) {
    case "won": {
      const payout = round2(stake * payoutMultiplier);
      return { stake, payout, profitLoss: round2(payout - stake), status };
    }
    case "lost":
      return { stake, payout: 0, profitLoss: round2(-stake), status };
    case "push":
    case "void":
      return { stake, payout: stake, profitLoss: 0, status };
    default:
      return { stake, payout: 0, profitLoss: 0, status: "pending" };
  }
}

/**
 * Settle a parlay from its legs' settlement statuses and a manual multiplier.
 * - any leg miss => lost
 * - a leg push/void reduces the effective multiplier (leg removed)
 * - all remaining legs hit => won
 */
export function settleParlay(
  stake: number,
  multiplier: number,
  legStatuses: SettlementStatus[],
): BankrollResult & { effectiveMultiplier: number } {
  if (legStatuses.length === 0 || legStatuses.some((s) => s === "pending")) {
    return {
      stake,
      payout: 0,
      profitLoss: 0,
      status: "pending",
      effectiveMultiplier: multiplier,
    };
  }
  if (legStatuses.some((s) => s === "miss")) {
    return {
      stake,
      payout: 0,
      profitLoss: round2(-stake),
      status: "lost",
      effectiveMultiplier: 0,
    };
  }
  const liveLegs = legStatuses.filter((s) => s === "hit").length;
  const removed = legStatuses.filter((s) => s === "push" || s === "void").length;

  if (liveLegs === 0) {
    // all legs voided/pushed → stake returned
    return {
      stake,
      payout: stake,
      profitLoss: 0,
      status: "void",
      effectiveMultiplier: 1,
    };
  }

  // Reduce the multiplier proportionally when legs are voided (approximation of
  // Underdog's leg-removal behavior; user can override the multiplier manually).
  const perLeg = Math.pow(multiplier, 1 / legStatuses.length);
  const effectiveMultiplier = removed > 0 ? Math.pow(perLeg, liveLegs) : multiplier;
  const payout = round2(stake * effectiveMultiplier);
  return {
    stake,
    payout,
    profitLoss: round2(payout - stake),
    status: "won",
    effectiveMultiplier: round2(effectiveMultiplier),
  };
}

// ---- Team moneyline ----

/** Profit on a winning moneyline bet from American odds. */
export function moneylinePayout(stake: number, priceAmerican: number): number {
  return priceAmerican > 0
    ? stake * (priceAmerican / 100)
    : stake * (100 / Math.abs(priceAmerican));
}

/** Settle a team moneyline bet. Defaults to even money if no price is known. */
export function settleTeamMoneyline(
  stake: number,
  priceAmerican: number | null | undefined,
  status: TeamStatus,
): BankrollResult {
  const price = priceAmerican ?? 100; // even money fallback
  switch (status) {
    case "win": {
      const profit = round2(moneylinePayout(stake, price));
      return { stake, payout: round2(stake + profit), profitLoss: profit, status: "won" };
    }
    case "loss":
      return { stake, payout: 0, profitLoss: round2(-stake), status: "lost" };
    case "push":
      return { stake, payout: stake, profitLoss: 0, status: "push" };
    case "void":
      return { stake, payout: stake, profitLoss: 0, status: "void" };
    default:
      return { stake, payout: 0, profitLoss: 0, status: "pending" };
  }
}

/** Determine a team pick's status from the game's actual winner. */
export function settleTeamResult(
  recommendedSide: "HOME" | "AWAY" | "DRAW",
  actualWinner: "HOME" | "AWAY" | "DRAW" | null | undefined,
): TeamStatus {
  if (!actualWinner) return "pending";
  return recommendedSide === actualWinner ? "win" : "loss";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
