import type { SerializedPick } from "@/lib/dto";
import { analyzeParlay, makeGameKey, type ParlayAnalysis, type ParlayLegInput } from "./parlayCorrelation";

/**
 * Suggested pick'em slips (pure, tested). Greedy by model confidence with
 * correlation rules: never the same player twice, never opposite directions in
 * the same game, prefer legs from different games; same-game/same-direction
 * legs are used only when nothing independent is left and are flagged.
 */

/** Standard Underdog "Standard" payouts by leg count (editable in the builder). */
export const PICKEM_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20 };

export interface SlipCandidate extends ParlayLegInput {
  line: number;
  sport: string;
  date: string;
  whyLine: string;
}

export interface SuggestedSlip {
  size: number;
  legs: SlipCandidate[];
  analysis: ParlayAnalysis;
  multiplier: number;
  flags: string[];
}

/** One-line, sourced justification for a leg: first "reason for", else the strongest evidence. */
export function whyLineFor(p: SerializedPick): string {
  if (p.reasonsFor.length > 0) return p.reasonsFor[0];
  const strongest = [...p.evidence].sort((a, b) => Math.abs(b.confidenceImpact) - Math.abs(a.confidenceImpact))[0];
  if (strongest) return `${strongest.title} (${strongest.sourceName})`;
  return p.reasoningSummary.split(". ")[0] || "Model lean";
}

export function pickToSlipCandidate(p: SerializedPick): SlipCandidate {
  return {
    pickId: p.id,
    playerName: p.prop.playerName,
    team: p.prop.team,
    opponent: p.prop.opponent,
    gameKey: makeGameKey(p.prop.team, p.prop.opponent, p.prop.date),
    propType: p.prop.propType,
    direction: p.prop.direction,
    confidenceScore: p.confidenceScore,
    riskLevel: p.riskLevel,
    line: p.prop.underdogLine ?? p.prop.line,
    sport: p.prop.sport,
    date: p.prop.date,
    whyLine: whyLineFor(p),
  };
}

function samePlayer(a: SlipCandidate, b: SlipCandidate): boolean {
  return a.playerName.trim().toLowerCase() === b.playerName.trim().toLowerCase();
}

function conflicts(a: SlipCandidate, b: SlipCandidate): boolean {
  return a.gameKey === b.gameKey && a.direction !== b.direction;
}

export function buildSuggestedSlips(
  candidates: SlipCandidate[],
  sizes: number[] = [2, 3, 4],
  opts?: { allowSameGame?: boolean; multipliers?: Record<number, number> },
): SuggestedSlip[] {
  const allowSameGame = opts?.allowSameGame ?? true;
  const multipliers = opts?.multipliers ?? PICKEM_MULTIPLIERS;
  const sorted = [...candidates].sort(
    (a, b) => b.confidenceScore - a.confidenceScore || a.playerName.localeCompare(b.playerName),
  );
  const out: SuggestedSlip[] = [];

  for (const size of sizes) {
    const legs: SlipCandidate[] = [];
    const flags: string[] = [];

    // Pass 1: fully independent legs (distinct players AND distinct games).
    for (const c of sorted) {
      if (legs.length >= size) break;
      if (legs.some((l) => samePlayer(l, c) || l.gameKey === c.gameKey)) continue;
      legs.push(c);
    }
    // Pass 2: fill from the same game, same direction only, if allowed.
    if (legs.length < size && allowSameGame) {
      for (const c of sorted) {
        if (legs.length >= size) break;
        if (legs.some((l) => l.pickId === c.pickId || samePlayer(l, c) || conflicts(l, c))) continue;
        legs.push(c);
        flags.push(`${c.playerName} shares a game with another leg — outcomes are positively correlated (same game script).`);
      }
    }
    if (legs.length < size) continue; // can't fill this size honestly

    out.push({
      size,
      legs,
      analysis: analyzeParlay(legs),
      multiplier: multipliers[size] ?? 1,
      flags,
    });
  }
  return out;
}
