import type { SerializedPick } from "@/lib/dto";
import { analyzeParlay, makeGameKey, type ParlayAnalysis, type ParlayLegInput } from "./parlayCorrelation";
import { entryMultiplier, legRequirement, type CorrelatedPair } from "./pickemMath";

/**
 * Suggested pick'em slips (pure, tested).
 *
 * Two rules below are Underdog's, not ours, and an entry breaking either is
 * rejected by the platform:
 *  - the same player may not appear twice in one entry;
 *  - an entry must contain players from at least two different teams.
 *
 * Note what the second rule does *not* say: team-mates are perfectly legal, and
 * a quarterback stacked with his own receiver is a standard construction, so
 * long as some third leg comes from another team. This builder used to refuse
 * every possible team-mate pairing, enforcing a stricter rule than the platform
 * actually has and throwing away the one edge available here that needs no
 * forecasting skill at all.
 *
 * Because a fixed multiplier pays only when every leg hits, the payoff depends
 * solely on P(all legs hit) — and positive correlation raises that number while
 * the multiplier, priced as if the legs were independent, does not move. So this
 * builder now *seeks* a QB/receiver stack rather than avoiding one. (Against a
 * true-odds sportsbook the opposite is correct, because the book reprices
 * correlation; that is where the older instinct came from.)
 *
 * A player's team comes from `teamId`, never from the prop's `team` field,
 * which holds the home side for Odds-API props and so cannot tell team-mates
 * apart.
 */

/** Standard Underdog "Standard" payouts by leg count (editable in the builder). */
export const PICKEM_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 6, 4: 10, 5: 20 };

const QB_PASS_PROPS = new Set(["Passing Yards", "Pass TDs", "Completions", "Pass Attempts"]);
const RECEIVER_PROPS = new Set(["Receiving Yards", "Receptions", "Rush+Rec Yards"]);

/**
 * Latent correlation between a QB's passing prop and his own receiver's.
 *
 * Measured at +0.34 on nflverse weekly data, 2022-2024 regular season (n=3,620
 * QB/receiver pairs, residuals against each player's trailing-6-game average).
 * Rounded down, because overstating correlation inflates the slip's estimate and
 * the whole point of the number is to be trustworthy.
 *
 * For contrast, two measurements that came back at essentially zero and so get
 * no adjustment at all: receivers on the same team (+0.003, n=4,016) and two
 * different games in the same week (-0.002, n=37,004). Only the quarterback
 * link is real.
 */
export const QB_STACK_RHO = 0.3;

/** Latent correlation between two legs, or 0 when they are effectively independent. */
export function stackRho(a: SlipCandidate, b: SlipCandidate): number {
  if (a.gameKey !== b.gameKey) return 0;
  if (!a.teamId || !b.teamId || a.teamId !== b.teamId) return 0;
  if (a.direction !== b.direction) return 0;
  const aPass = QB_PASS_PROPS.has(a.propType);
  const bPass = QB_PASS_PROPS.has(b.propType);
  if (aPass && RECEIVER_PROPS.has(b.propType)) return QB_STACK_RHO;
  if (bPass && RECEIVER_PROPS.has(a.propType)) return QB_STACK_RHO;
  return 0;
}

/** Correlated pairs within a slip, as indices, for `slipEconomics`. */
export function correlatedPairsFor(legs: SlipCandidate[]): CorrelatedPair[] {
  const pairs: CorrelatedPair[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const rho = stackRho(legs[i], legs[j]);
      if (rho > 0) pairs.push({ i, j, rho });
    }
  }
  return pairs;
}

export interface SlipCandidate extends ParlayLegInput {
  line: number;
  sport: string;
  date: string;
  whyLine: string;
  /** The player's own team id, when resolved. Null means unknown. */
  teamId: string | null;
  /**
   * Whether the platform posts this prop. null means nobody has checked, which
   * is treated as playable — the alternative is hiding picks on a guess.
   */
  available?: boolean | null;
  /** Underdog's per-pick payout tag (e.g. 0.85). Null or missing means standard. */
  pickMultiplier?: number | null;
}

export interface SlipFlag {
  /** "good" marks a dependency chosen on purpose, not a hazard to warn about. */
  tone: "good" | "info";
  text: string;
}

export interface SuggestedSlip {
  size: number;
  legs: SlipCandidate[];
  analysis: ParlayAnalysis;
  /** What the entry actually pays: the standard rung times every per-pick tag. */
  multiplier: number;
  /** The standard rung for this size, before per-pick tags. */
  baseMultiplier: number;
  flags: SlipFlag[];
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
    available: p.prop.underdogAvailable,
    pickMultiplier: p.prop.underdogPickMultiplier,
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
 * it depends on the resolved team ids, and an unknown id leaves it unproven.
 *
 * Team-mates are legal on Underdog, so this no longer blocks a pairing on its
 * own — `spansTwoTeams` is the rule that actually decides an entry's validity.
 * It stays exported because a *confirmed* stack needs confirmed team ids.
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
  // A prop confirmed absent from the platform cannot be part of an entry, so it
  // is dropped before ranking rather than suggested and rejected at the app.
  // Unchecked props stay in: absence of evidence is not evidence of absence.
  // Ranked by what a leg is worth at its own payout, not by raw probability.
  // A pick's contribution to the entry's expected value is p x its tag, so a
  // 65% pick tagged 0.85x (worth 55.3) sits below a 58% pick at full payout.
  // Ranking on probability alone favours exactly the lopsided picks Underdog
  // discounts — which is how a board fills up with low-line favourites.
  const value = (c: SlipCandidate) => c.confidenceScore * (c.pickMultiplier && c.pickMultiplier > 0 ? c.pickMultiplier : 1);
  const sorted = [...candidates]
    .filter((c) => c.available !== false)
    .sort((a, b) => value(b) - value(a) || a.playerName.localeCompare(b.playerName));
  const out: SuggestedSlip[] = [];

  for (const size of sizes) {
    const legs: SlipCandidate[] = [];

    /** Legal to add alongside what is already selected. */
    const eligible = (c: SlipCandidate) =>
      !legs.some((l) => l.pickId === c.pickId || samePlayer(l, c) || conflicts(l, c)) &&
      (allowSameGame || legs.every((l) => l.gameKey !== c.gameKey)) &&
      // The final leg has to leave the entry spanning two teams, or the
      // platform rejects it outright.
      (legs.length < size - 1 || spansTwoTeams([...legs, c]));

    while (legs.length < size) {
      // 1. A QB/receiver stack partner for a leg already chosen. Correlation is
      //    free expected value against a multiplier priced as if independent,
      //    so this is preferred over a marginally stronger unrelated pick.
      const stack = legs.length > 0
        ? sorted.find((c) => eligible(c) && legs.some((l) => stackRho(l, c) > 0))
        : undefined;
      // 2. Otherwise the best pick from a game not yet represented.
      const fresh = sorted.find((c) => eligible(c) && legs.every((l) => l.gameKey !== c.gameKey));
      // 3. Otherwise anything legal.
      const next = stack ?? fresh ?? sorted.find(eligible);
      if (!next) break;
      legs.push(next);
    }

    if (legs.length < size) continue; // can't fill this size honestly
    if (!spansTwoTeams(legs)) continue; // Underdog rejects single-team entries

    const base = multipliers[size] ?? 1;
    out.push({
      size,
      legs,
      analysis: analyzeParlay(legs),
      baseMultiplier: base,
      multiplier: entryMultiplier(base, legs.map((l) => l.pickMultiplier)),
      flags: [...flagsFor(legs), ...tagFlags(legs, base)],
    });
  }
  return out;
}

/** Notes for legs carrying a per-pick payout tag, with what each then has to hit. */
function tagFlags(legs: SlipCandidate[], base: number): SlipFlag[] {
  return legs
    .filter((l) => l.pickMultiplier != null && l.pickMultiplier > 0 && l.pickMultiplier !== 1)
    .map((l) => {
      const m = l.pickMultiplier as number;
      const need = legRequirement(base, legs.length, m);
      const needText = need == null ? "" : need >= 1 ? " — no hit rate can justify it at this size" : `, so it needs ${(need * 100).toFixed(1)}% to earn its place`;
      return {
        tone: "info" as const,
        text:
          `${l.playerName} pays ${m}× on Underdog` +
          (m < 1 ? " (a discount — Underdog also rates this side likely)" : " (a boost — Underdog rates this side unlikely)") +
          needText + ".",
      };
    });
}

/** Plain-language notes about dependencies between the chosen legs. */
function flagsFor(legs: SlipCandidate[]): SlipFlag[] {
  const flags: SlipFlag[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (stackRho(a, b) > 0) {
        flags.push({
          tone: "good",
          text:
            `${a.playerName} + ${b.playerName} is a same-team stack — their outcomes move together ` +
            `(measured correlation +0.34). The multiplier is priced as if they were independent, so ` +
            `this raises the chance the whole slip lands. Chosen on purpose, not a hazard.`,
        });
      } else if (a.gameKey === b.gameKey && a.teamId && b.teamId && a.teamId !== b.teamId) {
        flags.push({
          tone: "info",
          text:
            `${a.playerName} and ${b.playerName} share a game but play for opposing teams — measured ` +
            `correlation is about +0.04, so they count as independent.`,
        });
      }
    }
  }
  return flags;
}
