import {
  TEAM_CATEGORY_WEIGHTS,
  TEAM_MODEL_VERSION,
  type EvidenceItem,
  type GameInput,
  type TeamPickAnalysis,
  type TeamScoreBreakdown,
  type TeamScoreCategory,
  type TeamSide,
} from "@/types";
import { clamp } from "./stats";
import { deriveRiskLevel } from "./confidenceModel";

export const TEAM_SCORING_MODEL_VERSION = TEAM_MODEL_VERSION;

const pct = (p: number) => `${Math.round(p * 100)}%`;

function parseWinPct(record?: string): number | undefined {
  if (!record) return undefined;
  const m = record.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const l = Number(m[2]);
  const d = m[3] ? Number(m[3]) : 0;
  const games = w + l + d;
  if (games === 0) return undefined;
  return (w + d * 0.5) / games; // draws count as half for form
}

/**
 * Score a game and recommend a team to win. Anchored on the de-vigged market
 * probability, adjusted modestly by form, home advantage and injuries. Missing
 * inputs contribute a neutral sub-score and a recorded warning (never faked).
 */
export function analyzeGame(game: GameInput): TeamPickAnalysis {
  const market = game.market;
  const warnings: string[] = [];

  // ---- adjusted model win probabilities ----
  let homeProb = market?.homeProb ?? 1 / (game.threeWay ? 3 : 2);
  let awayProb = market?.awayProb ?? 1 / (game.threeWay ? 3 : 2);
  let drawProb = market?.drawProb ?? (game.threeWay ? 1 / 3 : 0);
  if (!market) warnings.push("No market odds available — win probabilities are unreliable.");

  const homeWinPct = game.form?.homeWinPct ?? parseWinPct(game.form?.homeRecord);
  const awayWinPct = game.form?.awayWinPct ?? parseWinPct(game.form?.awayRecord);
  const hasForm = homeWinPct != null && awayWinPct != null;
  if (!hasForm) warnings.push("No team form/record available.");

  // Blend several form signals into a single, capped shift toward the stronger
  // side. The market (40% anchor) already prices most of this in, so the total
  // form-driven swing is capped at ±0.10 to avoid fabricating value.
  let formShift = 0;
  if (hasForm) {
    formShift += ((homeWinPct as number) - (awayWinPct as number)) * 0.08; // season record
  }
  const homeL10 = game.form?.homeLast10Pct;
  const awayL10 = game.form?.awayLast10Pct;
  const hasL10 = homeL10 != null && awayL10 != null;
  if (hasL10) {
    formShift += ((homeL10 as number) - (awayL10 as number)) * 0.05; // recent 10 games
  }
  const homeRD = game.form?.homeRunDiff;
  const awayRD = game.form?.awayRunDiff;
  const hasRunDiff = homeRD != null && awayRD != null;
  if (hasRunDiff) {
    // ~100-run seasonal gap ≈ a 5-point probability nudge.
    formShift += clamp(((homeRD as number) - (awayRD as number)) / 100, -1, 1) * 0.05;
  }
  // Probable-pitcher quality (MLB): a lower ERA on the home side helps home.
  const homeEra = game.pitchers?.home?.era;
  const awayEra = game.pitchers?.away?.era;
  const hasPitchers = homeEra != null && awayEra != null;
  if (hasPitchers) {
    formShift += clamp(((awayEra as number) - (homeEra as number)) / 3, -1, 1) * 0.04;
  }
  formShift = clamp(formShift, -0.1, 0.1);
  homeProb += formShift;
  awayProb -= formShift;

  // Home field is already priced into the market, so we do NOT shift probability
  // for it (that would fabricate value on every home team) — it only contributes
  // a small confidence factor via the homeAdvantage sub-score below.

  const hasInjuries = game.injuries != null;
  if (!hasInjuries) warnings.push("Injury data not available for this game.");
  if (game.injuries) {
    const injDiff = (game.injuries.awayKeyOut ?? 0) - (game.injuries.homeKeyOut ?? 0);
    const inj = clamp(injDiff * 0.012, -0.05, 0.05); // more away players out helps home
    homeProb += inj;
    awayProb -= inj;
  }

  homeProb = clamp(homeProb, 0.01, 0.99);
  awayProb = clamp(awayProb, 0.01, 0.99);
  drawProb = clamp(drawProb, 0, 0.99);
  const norm = homeProb + awayProb + drawProb || 1;
  homeProb /= norm;
  awayProb /= norm;
  drawProb /= norm;

  // ---- recommend the stronger side to WIN (home vs away) ----
  const recommendedSide: TeamSide = homeProb >= awayProb ? "HOME" : "AWAY";
  const recommendedTeam = recommendedSide === "HOME" ? game.homeTeam : game.awayTeam;
  const winProbability = recommendedSide === "HOME" ? homeProb : awayProb;
  const marketWinProb =
    recommendedSide === "HOME" ? market?.homeProb ?? winProbability : market?.awayProb ?? winProbability;
  const valueEdge = winProbability - marketWinProb;
  const priceAmerican = recommendedSide === "HOME" ? market?.homePrice : market?.awayPrice;
  const isHome = recommendedSide === "HOME";
  const oppWinPct = isHome ? awayWinPct : homeWinPct;
  const teamWinPct = isHome ? homeWinPct : awayWinPct;

  // ---- category sub-scores (recommended side's perspective) ----
  const evidence: EvidenceItem[] = [];
  const reasonsFor: string[] = [];
  const reasonsAgainst: string[] = [];

  const marketScore = clamp(50 + (marketWinProb - 0.5) * 100, 0, 100);
  if (market) {
    evidence.push({
      category: "marketProb",
      title: `Market win probability ${pct(marketWinProb)}`,
      summary: `Sharp market makes ${recommendedTeam} a ${
        marketWinProb >= 0.5 ? "favorite" : "underdog"
      } at ${pct(marketWinProb)} (de-vig, ${market.bookCount} book${market.bookCount === 1 ? "" : "s"}).`,
      confidenceImpact: Math.round((marketScore - 50) / 3),
      sourceName: market.source,
    });
    if (marketWinProb >= 0.6) reasonsFor.push(`Market favors ${recommendedTeam} (${pct(marketWinProb)}).`);
  }

  const opponent = isHome ? game.awayTeam : game.homeTeam;
  let formScore = 50;
  if (hasForm) {
    const favor = (teamWinPct as number) - (oppWinPct as number);
    let pts = favor * 70;

    // Recent form (last 10) and run differential sharpen the record signal.
    const teamL10 = isHome ? homeL10 : awayL10;
    const oppL10 = isHome ? awayL10 : homeL10;
    if (teamL10 != null && oppL10 != null) pts += (teamL10 - oppL10) * 40;
    const teamRD = isHome ? homeRD : awayRD;
    const oppRD = isHome ? awayRD : homeRD;
    if (teamRD != null && oppRD != null) pts += clamp((teamRD - oppRD) / 100, -1, 1) * 25;
    formScore = clamp(50 + pts, 0, 100);

    evidence.push({
      category: "form",
      title: `Form: ${recommendedTeam} ${pct(teamWinPct as number)} win rate`,
      summary: `${recommendedTeam} (${isHome ? game.form?.homeRecord : game.form?.awayRecord}) vs ${opponent} (${
        isHome ? game.form?.awayRecord : game.form?.homeRecord
      }).`,
      confidenceImpact: Math.round((formScore - 50) / 3),
      sourceName: game.form?.source ?? "ESPN",
    });
    if (favor > 0.08) reasonsFor.push(`${recommendedTeam} has the stronger record.`);
    if (favor < -0.08) reasonsAgainst.push(`Opponent has the stronger record.`);

    // Concrete recent-form evidence, when the richer splits are available.
    const teamL10Rec = isHome ? game.form?.homeLast10Record : game.form?.awayLast10Record;
    const oppL10Rec = isHome ? game.form?.awayLast10Record : game.form?.homeLast10Record;
    if (teamL10 != null && oppL10 != null && teamL10Rec && oppL10Rec) {
      evidence.push({
        category: "form",
        title: `Last 10: ${recommendedTeam} ${teamL10Rec}`,
        summary: `Recent form — ${recommendedTeam} ${teamL10Rec} vs ${opponent} ${oppL10Rec} over their last 10.`,
        confidenceImpact: Math.round((teamL10 - oppL10) * 12),
        sourceName: game.form?.source ?? "MLB Stats API",
      });
      if (teamL10 - oppL10 > 0.2) reasonsFor.push(`${recommendedTeam} is hotter over the last 10 (${teamL10Rec}).`);
      if (teamL10 - oppL10 < -0.2) reasonsAgainst.push(`${opponent} is hotter over the last 10 (${oppL10Rec}).`);
    }
    if (teamRD != null && oppRD != null) {
      const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      evidence.push({
        category: "form",
        title: `Run differential ${fmt(teamRD)}`,
        summary: `${recommendedTeam} run differential ${fmt(teamRD)} vs ${opponent} ${fmt(oppRD)}.`,
        confidenceImpact: Math.round(clamp((teamRD - oppRD) / 100, -1, 1) * 15),
        sourceName: game.form?.source ?? "MLB Stats API",
      });
    }
    const teamStreak = isHome ? game.form?.homeStreak : game.form?.awayStreak;
    if (teamStreak && /^W[3-9]|W1\d/.test(teamStreak)) {
      reasonsFor.push(`${recommendedTeam} enters on a ${teamStreak} streak.`);
    }
    if (teamStreak && /^L[3-9]|L1\d/.test(teamStreak)) {
      reasonsAgainst.push(`${recommendedTeam} enters on a ${teamStreak} skid.`);
    }
  }

  // Probable-pitcher matchup (MLB): concrete starter comparison.
  if (hasPitchers) {
    const teamP = isHome ? game.pitchers?.home : game.pitchers?.away;
    const oppP = isHome ? game.pitchers?.away : game.pitchers?.home;
    if (teamP && oppP) {
      const teamEra = isHome ? homeEra : awayEra;
      const oppEraVal = isHome ? awayEra : homeEra;
      const eraEdge = (oppEraVal as number) - (teamEra as number); // + = our starter better
      evidence.push({
        category: "form",
        title: `Probable SP: ${teamP.name || "TBD"}`,
        summary: `${recommendedTeam} start ${teamP.name || "TBD"} (${
          teamP.era != null ? `${teamP.era.toFixed(2)} ERA` : "ERA n/a"
        }) vs ${opponent}'s ${oppP.name || "TBD"} (${oppP.era != null ? `${oppP.era.toFixed(2)} ERA` : "ERA n/a"}).`,
        confidenceImpact: Math.round(clamp(eraEdge / 3, -1, 1) * 8),
        sourceName: "MLB Stats API",
      });
      if (eraEdge > 0.75) reasonsFor.push(`Starting-pitcher edge to ${teamP.name || recommendedTeam}.`);
      if (eraEdge < -0.75) reasonsAgainst.push(`Opposing starter ${oppP.name} has the better ERA.`);
    }
  }

  let injuryScore = 50;
  if (game.injuries) {
    const teamOut = isHome ? game.injuries.homeKeyOut ?? 0 : game.injuries.awayKeyOut ?? 0;
    const oppOut = isHome ? game.injuries.awayKeyOut ?? 0 : game.injuries.homeKeyOut ?? 0;
    injuryScore = clamp(50 + clamp(oppOut - teamOut, -6, 6) * 6, 0, 100);
    const named = (game.injuries.notes ?? []).map((n) => n.summary).join("; ");
    evidence.push({
      category: "injuries",
      title: "Injuries & availability",
      summary:
        named ||
        `${teamOut} key player${teamOut === 1 ? "" : "s"} out for ${recommendedTeam}, ${oppOut} for ${opponent}.`,
      confidenceImpact: Math.round((injuryScore - 50) / 4),
      sourceName: game.injuries.source,
    });
    if (oppOut - teamOut >= 2) reasonsFor.push(`${opponent} is missing more key players (${oppOut} out).`);
    if (teamOut - oppOut >= 2) reasonsAgainst.push(`${recommendedTeam} is missing ${teamOut} key players.`);
  }

  const homeAdvScore = isHome ? 60 : 42;
  evidence.push({
    category: "homeAdvantage",
    title: isHome ? "Playing at home" : "Playing on the road",
    summary: isHome ? `${recommendedTeam} host this game.` : `${recommendedTeam} play away from home.`,
    confidenceImpact: Math.round((homeAdvScore - 50) / 5),
    sourceName: "PropEdge model",
  });

  const valueScore = clamp(50 + valueEdge * 400, 0, 100);
  if (market) {
    evidence.push({
      category: "value",
      title: `Value edge ${valueEdge >= 0 ? "+" : ""}${(valueEdge * 100).toFixed(1)}%`,
      summary: `Model win probability ${pct(winProbability)} vs ${pct(marketWinProb)} market-implied.`,
      confidenceImpact: Math.round((valueScore - 50) / 4),
      sourceName: "PropEdge model",
    });
    if (valueEdge >= 0.04)
      reasonsFor.push(`Value: model rates ${recommendedTeam} ${(valueEdge * 100).toFixed(1)}% above the price.`);
    if (valueEdge <= -0.04)
      reasonsAgainst.push(`No pricing value — model is below the market on this side.`);
  }

  // ---- aggregate (renormalize over categories with data) ----
  const breakdown: TeamScoreBreakdown = {
    marketProb: round1(marketScore),
    form: round1(formScore),
    injuries: round1(injuryScore),
    homeAdvantage: round1(homeAdvScore),
    value: round1(valueScore),
  };
  const hasData: Record<TeamScoreCategory, boolean> = {
    marketProb: Boolean(market),
    form: hasForm,
    injuries: hasInjuries,
    homeAdvantage: true,
    value: Boolean(market),
  };
  const inputCats: TeamScoreCategory[] = ["marketProb", "form", "injuries", "homeAdvantage", "value"];
  const completeness = inputCats.filter((c) => hasData[c]).length / inputCats.length;

  let wNum = 0;
  let wDen = 0;
  for (const cat of inputCats) {
    if (hasData[cat]) {
      wNum += TEAM_CATEGORY_WEIGHTS[cat] * breakdown[cat];
      wDen += TEAM_CATEGORY_WEIGHTS[cat];
    }
  }
  const rawWeighted = wDen > 0 ? wNum / wDen : 50;
  const dampen = 0.6 + 0.4 * completeness;
  const confidenceScore = Math.round(clamp(50 + (rawWeighted - 50) * dampen, 0, 100));

  // Closeness proxy for risk: coin flips are riskier than locks.
  const closeness = 1 - Math.abs(winProbability - 0.5) * 2;
  const riskLevel = deriveRiskLevel(confidenceScore, closeness, completeness);

  // ---- draw risk & tags ----
  if (game.threeWay && drawProb >= 0.28) {
    warnings.push(
      `High draw risk (${pct(drawProb)}) — this is a moneyline (team-to-win) pick, so a draw loses it.`,
    );
  }
  const tags = buildTags(winProbability, valueEdge, isHome, drawProb, game.threeWay);

  const { reasoningSummary, deepDiveAnalysis, verdict } = buildNarrative(
    recommendedTeam,
    winProbability,
    marketWinProb,
    valueEdge,
    riskLevel,
    reasonsFor,
    reasonsAgainst,
    completeness,
  );

  return {
    recommendedSide,
    recommendedTeam,
    winProbability: round3(winProbability),
    marketWinProb: round3(marketWinProb),
    valueEdge: round3(valueEdge),
    priceAmerican: priceAmerican ?? undefined,
    drawProbability: game.threeWay ? round3(drawProb) : undefined,
    confidenceScore,
    edgeScore: Math.round(valueEdge * 1000) / 10, // value edge in %-points
    riskLevel,
    scoreBreakdown: breakdown,
    evidence,
    warnings: [...new Set(warnings)],
    reasonsFor: [...new Set(reasonsFor)],
    reasonsAgainst: [...new Set(reasonsAgainst)],
    reasoningSummary,
    deepDiveAnalysis,
    verdict,
    tags,
    dataCompleteness: round1(completeness),
  };
}

function buildTags(
  winProb: number,
  valueEdge: number,
  isHome: boolean,
  drawProb: number,
  threeWay: boolean,
): string[] {
  const tags = new Set<string>();
  if (winProb >= 0.65) tags.add("favorite");
  if (Math.abs(winProb - 0.5) < 0.05) tags.add("coin flip");
  if (valueEdge >= 0.03) tags.add(winProb < 0.5 ? "upset value" : "value");
  tags.add(isHome ? "home" : "road");
  if (threeWay && drawProb >= 0.28) tags.add("draw risk");
  return [...tags];
}

function buildNarrative(
  team: string,
  winProb: number,
  marketProb: number,
  valueEdge: number,
  risk: string,
  reasonsFor: string[],
  reasonsAgainst: string[],
  completeness: number,
) {
  const strength =
    winProb >= 0.65 ? `Strong lean to ${team}` : winProb >= 0.55 ? `Lean ${team}` : `Slight edge to ${team}`;
  const valueNote =
    valueEdge >= 0.04
      ? ` with ${(valueEdge * 100).toFixed(1)}% value over the price`
      : valueEdge <= -0.04
        ? " (no pricing value — a confidence pick, not a value bet)"
        : "";
  const support = reasonsFor.slice(0, 3).join("; ") || "market/form balance";
  const risks = reasonsAgainst.slice(0, 2).join("; ") || "upset variance in a single game";

  const reasoningSummary = `${strength}${valueNote}. Model win probability ${pct(winProb)} vs ${pct(
    marketProb,
  )} market. Supported by ${support}. Risks: ${risks}.`;

  const deepDiveAnalysis =
    `The model gives ${team} a ${pct(winProb)} chance to win, versus ${pct(marketProb)} implied by the ` +
    `sharp market (${valueEdge >= 0 ? "+" : ""}${(valueEdge * 100).toFixed(1)}% value), at ${risk.toLowerCase()} risk. ` +
    `Drivers: ${support}. Countervailing: ${risks}. ` +
    (completeness < 0.6 ? "Some inputs were unavailable, so treat this as provisional. " : "") +
    `A single game is high variance — this is research, not financial advice.`;

  const verdict = `Verdict: ${strength}${valueNote}. Primary risk: ${risks}. All picks carry risk.`;
  return { reasoningSummary, deepDiveAnalysis, verdict };
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}
