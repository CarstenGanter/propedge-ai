import type { SerializedPick } from "@/lib/dto";
import { analyzeParlay, makeGameKey, type ParlayAnalysis, type ParlayLegInput } from "./parlayCorrelation";

/**
 * Suggested pick'em slips (pure, tested).
 *
 * Two of the rules below are Underdog's, not ours, and an entry that breaks
 * either is rejected by the platform:
 *  - the same player may not appear twice in one entry;
 *  - an entry must contain players from at least two different teams.
 * The rest are ours: never take opposite sides of the same game, and prefer
 * legs from different games, flagging same-game legs as correlated.
 *
 * A player's team comes from `teamId`, never from the prop's `team` field,
 * which holds the home side for Odds-API props and so cannot tell team-mates
 * apart. When a team is unknown we treat two same-game players as *possibly*
 * team-mates and refuse to pair them, since suggesting an entry the platform
 * will reject is worse than suggesting one fewer.
 */

/** Standard Underdog "Standard" payouts by leg count (editable in the builder). */
export const PICKEM_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20 };

export interface SlipCandidate extends ParlayLegInput {
  line: number;
  sport: string;
  date: string;
  whyLine: string;
  /** The player's own team id, when resolved. Null means unknown. */
  teamId: string | null;
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
    teamId: p.prop.playerTeamId,
  };
}

function samePlayer(a: SlipCandidate, b: SlipCandidate): boolean {
  return a.playerName.trim().toLowerCase() === b.playerName.trim().toLowerCase();
}

function conflicts(a: SlipCandidate, b: SlipCandidate): boolean {
  return a.gameKey === b.gameKey && a.direction !== b.direction;
}

/**
 * Could these two be team-mates? Different games rules it out. Within one game
 * it depends on the resolved team ids, and an unknown id is treated as "maybe"
 * so we never propose an entry the platform would reject.
 */
export function maybeTeammates(a: SlipCandidate, b: SlipCandidate): boolean {
  if (a.gameKey !== b.gameKey) return false;
  if (a.teamId && b.teamId) return a.teamId === b.teamId;
  return true;
}

/** Underdog requires an entry to span at least two different teams. */
export function spansTwoTeams(legs: SlipCandidate[]): boolean {
  if (legs.length < 2) return false;
  if (legs.some((l) => l.gameKey !== legs[0].gameKey)) return true; // different games
  const ids = legs.map((l) => l.teamId);
  if (ids.some((id) => !id)) return false; // unknown within one game — can't prove it
  return new Set(ids).size >= 2;
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
    // Pass 2: fill from the same game, same direction, opposing teams only.
    if (legs.length < size && allowSameGame) {
      for (const c of sorted) {
        if (legs.length >= size) break;
        if (legs.some((l) => l.pickId === c.pickId || samePlayer(l, c) || conflicts(l, c))) continue;
        // Team-mates (or possible team-mates) would make the entry invalid.
        if (legs.some((l) => maybeTeammates(l, c))) continue;
        legs.push(c);
        flags.push(`${c.playerName} shares a game with another leg — outcomes are positively correlated (same game script).`);
      }
    }
    if (legs.length < size) continue; // can't fill this size honestly
    if (!spansTwoTeams(legs)) continue; // Underdog rejects single-team entries

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
