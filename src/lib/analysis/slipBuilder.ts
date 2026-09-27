import type { SerializedPick } from "@/lib/dto";
import { analyzeParlay, makeGameKey, type ParlayAnalysis, type ParlayLegInput } from "./parlayCorrelation";
import { entryMultiplier, pickBreakEven, pickValue, STANDARD_PICK_PAYOUT, type CorrelatedPair } from "./pickemMath";

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

/**
 * What an entry of standard picks pays, by leg count. Underdog prices each pick
 * (see STANDARD_PICK_PAYOUT) and pays the product, so these are 1.87^n. The 2-
 * and 3-leg figures are confirmed from real entries (3.5x, 6.5x); 4 and 5 follow
 * the same rule but have not been seen yet. An entry with its picks' own payouts
 * entered is priced from those instead.
 */
export const PICKEM_MULTIPLIERS: Record<number, number> = Object.fromEntries(
  [2, 3, 4, 5].map((n) => [n, Math.round(STANDARD_PICK_PAYOUT ** n * 10) / 10]),
);

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
  /** What Underdog pays for this pick (e.g. 1.71). Null or missing means a standard 1.87x pick. */
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
  //
  // Ranked by what a leg is worth at its own payout — probability times payout —
  // not by raw probability. Underdog pays less for the sides it rates likely, so
  // ranking on probability alone favours exactly the short-priced favourites,
  // which is how a board fills up with low-line Unders. A 65% pick paying 1.55x
  // (worth 1.01) sits below a 60% pick at the standard 1.87x (worth 1.12).
  //
  // A pick whose entered payout is too short for its probability (value below
  // 1) is left out entirely: it lowers the expected value of any slip it joins.
  // Unpriced picks stay in at the standard payout.
  const value = (c: SlipCandidate) => pickValue(c.confidenceScore / 100, c.pickMultiplier);
  const sorted = [...candidates]
    .filter((c) => c.available !== false)
    .filter((c) => c.pickMultiplier == null || value(c) >= 1)
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
    const priced = legs.some((l) => l.pickMultiplier != null);
    out.push({
      size,
      legs,
      analysis: analyzeParlay(legs),
      baseMultiplier: base,
      // Priced from the picks' own payouts once any are entered; otherwise the
      // standard rung (which may be overridden, e.g. for another platform).
      multiplier: priced ? entryMultiplier(legs.map((l) => l.pickMultiplier)) : base,
      flags: [...flagsFor(legs), ...payoutFlags(legs)],
    });
  }
  return out;
}

/** Notes on pricing: what each priced leg needs, and Underdog's same-game trim. */
function payoutFlags(legs: SlipCandidate[]): SlipFlag[] {
  const flags: SlipFlag[] = legs
    .filter((l) => l.pickMultiplier != null && l.pickMultiplier > 0)
    .map((l) => ({
      tone: "info" as const,
      text:
        `${l.playerName} pays ${l.pickMultiplier}× — needs ${(pickBreakEven(l.pickMultiplier) * 100).toFixed(1)}%, ` +
        `model says ${Math.round(l.confidenceScore)}%.`,
    }));
  const games = new Set(legs.map((l) => l.gameKey));
  if (games.size < legs.length && legs.some((l) => l.pickMultiplier != null)) {
    flags.push({
      tone: "info",
      text:
        "Some legs share a game, and Underdog pays a little under the product for same-game entries " +
        "(seen: 1–7%). Type in the total the app shows.",
    });
  }
  return flags;
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
