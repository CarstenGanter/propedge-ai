import {
  MODEL_VERSION,
  weightsForProfile,
  type Direction,
  type EvidenceItem,
  type NewsContext,
  type PickAnalysis,
  type ResearchBundle,
  type ScorablePropInput,
  type ScoreBreakdown,
  type ScoreCategory,
  type ScoringProfile,
} from "@/types";

type PlayerStatus = NonNullable<NewsContext["playerStatus"]>;
import { clamp, hitCount, marginToScore, mean, median, stdDev } from "./stats";
import { deriveRiskLevel } from "./confidenceModel";

export const SCORING_MODEL_VERSION = MODEL_VERSION;

interface CategoryResult {
  score: number; // 0..100, 50 = neutral
  hasData: boolean;
  evidence: EvidenceItem[];
  warnings: string[];
  reasonsFor: string[];
  reasonsAgainst: string[];
}

const neutral = (): CategoryResult => ({
  score: 50,
  hasData: false,
  evidence: [],
  warnings: [],
  reasonsFor: [],
  reasonsAgainst: [],
});

function dirSign(direction: Direction): 1 | -1 {
  return direction === "OVER" ? 1 : -1;
}

const overUnderWord = (d: Direction) => (d === "OVER" ? "over" : "under");

// ---- Category scorers ---------------------------------------------------

function scoreRecentForm(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const ps = bundle.playerStats;
  if (!ps || ps.recentGames.length === 0) {
    return {
      ...neutral(),
      warnings: ["No recent game log available — recent form could not be evaluated."],
    };
  }
  const res = neutral();
  res.hasData = true;
  const games = ps.recentGames;
  const line = prop.line;
  const dir = prop.direction;

  const l3 = games.slice(0, 3);
  const l5 = games.slice(0, 5);
  const l10 = games.slice(0, 10);
  const h3 = hitCount(l3, line, dir);
  const h5 = hitCount(l5, line, dir);
  const h10 = hitCount(l10, line, dir);

  const rate = (h: { hits: number; total: number }) =>
    h.total ? h.hits / h.total : 0.5;
  // weight the most recent window a bit more
  const blended =
    0.5 * rate(h3) + 0.3 * rate(h5) + 0.2 * rate(h10);

  // trend: recent half vs older half of last 10
  const half = Math.max(1, Math.floor(l10.length / 2));
  const recentAvg = mean(l10.slice(0, half));
  const olderAvg = mean(l10.slice(half));
  const trend = recentAvg - olderAvg; // positive => rising production
  const trendFavor = dirSign(dir) * trend;

  const base = 50 + (blended - 0.5) * 90; // hit-rate is the dominant driver
  const trendAdj = clamp(trendFavor / Math.max(1, line * 0.15), -1, 1) * 8;
  res.score = clamp(base + trendAdj, 0, 100);

  const window = h10.total >= 10 ? "10" : String(h10.total);
  res.evidence.push({
    category: "recentForm",
    title: `Cleared the ${dir.toLowerCase()} in ${h10.hits} of last ${window} games`,
    summary: `Over the last ${window} games this player finished on the ${overUnderWord(
      dir,
    )} side of ${line} in ${h10.hits} of them (${Math.round(rate(h10) * 100)}%).`,
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: ps.source,
  });

  if (rate(h3) >= 0.66) {
    res.reasonsFor.push(
      `Hot recent stretch: ${h3.hits}/${h3.total} on the ${overUnderWord(dir)} in the last ${h3.total}.`,
    );
  }
  if (trendFavor > 0 && Math.abs(trend) > line * 0.1) {
    res.reasonsFor.push(`Production trending ${dir === "OVER" ? "up" : "down"} recently.`);
  }
  if (rate(h10) < 0.4) {
    res.reasonsAgainst.push(
      `Recent hit rate is soft (${Math.round(rate(h10) * 100)}% over last ${window}).`,
    );
  }
  return res;
}

function scoreSeasonBaseline(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const ps = bundle.playerStats;
  if (!ps) {
    return {
      ...neutral(),
      warnings: ["No season baseline available."],
    };
  }
  const res = neutral();
  res.hasData = true;
  const games = ps.recentGames;
  const avg = ps.seasonAverage ?? mean(games);
  const med = ps.seasonMedian ?? median(games);
  const sd = ps.seasonStdDev ?? stdDev(games);
  const line = prop.line;

  const favorMargin = dirSign(prop.direction) * (avg - line);
  const scale = Math.max(sd || line * 0.2, line * 0.08);
  res.score = marginToScore(favorMargin, scale);

  const pctClearing = games.length
    ? hitCount(games, line, prop.direction).hits / games.length
    : 0.5;

  res.evidence.push({
    category: "seasonBaseline",
    title: `Season average ${avg.toFixed(1)} vs line ${line}`,
    summary: `Season average is ${avg.toFixed(1)} (median ${med.toFixed(
      1,
    )}, ~${Math.round(pctClearing * 100)}% of games on the ${overUnderWord(
      prop.direction,
    )}). Standard deviation ~${sd.toFixed(1)}.`,
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: ps.source,
  });

  if (favorMargin > scale * 0.4) {
    res.reasonsFor.push(
      `Baseline sits clearly on the ${overUnderWord(prop.direction)} side of the line.`,
    );
  } else if (favorMargin < -scale * 0.4) {
    res.reasonsAgainst.push(
      `Season baseline works against the ${overUnderWord(prop.direction)}.`,
    );
  }
  return res;
}

function scoreMatchup(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const m = bundle.matchup;
  if (!m) {
    return { ...neutral(), warnings: ["No opponent matchup data available."] };
  }
  const res = neutral();
  res.hasData = true;
  let acc = 50;
  const parts: string[] = [];

  if (m.opponentContext) parts.push(m.opponentContext);

  if (m.opponentDefenseRank && m.leagueSize) {
    // rank 1 = toughest, leagueSize = softest. Favors OVER when soft.
    const softness = (m.opponentDefenseRank - 1) / Math.max(1, m.leagueSize - 1); // 0..1
    const favor = prop.direction === "OVER" ? softness - 0.5 : 0.5 - softness;
    acc += favor * 60;
    parts.push(
      `Opponent ranks ${m.opponentDefenseRank}/${m.leagueSize} defending this stat (${
        softness > 0.6 ? "soft" : softness < 0.4 ? "tough" : "average"
      }).`,
    );
  }
  if (m.opponentAllowedAverage != null) {
    const favorMargin = dirSign(prop.direction) * (m.opponentAllowedAverage - prop.line);
    acc += clamp(favorMargin / Math.max(1, prop.line * 0.2), -1, 1) * 15;
    parts.push(`Allows ~${m.opponentAllowedAverage.toFixed(1)} to the position.`);
  }
  if (m.pace) {
    const paceFavor = m.pace === "fast" ? 1 : m.pace === "slow" ? -1 : 0;
    acc += (prop.direction === "OVER" ? paceFavor : -paceFavor) * 6;
    parts.push(`${m.pace} pace/environment.`);
  }
  res.score = clamp(acc, 0, 100);
  res.evidence.push({
    category: "matchup",
    title: `Matchup ${res.score >= 58 ? "favors" : res.score <= 42 ? "works against" : "is neutral for"} the ${overUnderWord(prop.direction)}`,
    summary: parts.join(" ") || "Limited matchup detail available.",
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: m.source,
  });
  if (res.score >= 60) res.reasonsFor.push("Favorable defensive matchup for this stat.");
  if (res.score <= 40) res.reasonsAgainst.push("Tough defensive matchup for this stat.");
  return res;
}

function scoreRoleUsage(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const ps = bundle.playerStats;
  const news = bundle.news;
  const hasUsage = ps?.usage != null || ps?.usageTrend != null;
  const hasBoost = news?.teammateAbsencesBoost != null;
  if (!hasUsage && !hasBoost) {
    return {
      ...neutral(),
      warnings: ["No role/usage signal available (minutes, snaps, touches, etc.)."],
    };
  }
  const res = neutral();
  res.hasData = true;
  let acc = 50;
  const parts: string[] = [];

  if (ps?.usageTrend) {
    const t = ps.usageTrend === "up" ? 1 : ps.usageTrend === "down" ? -1 : 0;
    // For counting stats, rising usage helps the OVER, hurts the UNDER.
    acc += (prop.direction === "OVER" ? t : -t) * 14;
    parts.push(`Usage trending ${ps.usageTrend}.`);
  }
  if (news?.teammateAbsencesBoost) {
    acc += prop.direction === "OVER" ? 12 : -8;
    parts.push("Teammate absence(s) likely increase opportunity.");
    if (prop.direction === "OVER") res.reasonsFor.push("Opportunity boost from teammate absence.");
  }
  if (ps?.usage != null) {
    parts.push(`Recent usage/volume metric ~${ps.usage.toFixed(1)}.`);
  }
  res.score = clamp(acc, 0, 100);
  res.evidence.push({
    category: "roleUsage",
    title: "Role & usage context",
    summary: parts.join(" "),
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: ps?.source ?? news?.source ?? "manual/demo data",
  });
  if (res.score >= 60 && prop.direction === "OVER")
    res.reasonsFor.push("Strong/expanding role supports volume.");
  if (res.score <= 40)
    res.reasonsAgainst.push("Role/usage trend is unfavorable for this pick.");
  return res;
}

function scoreInjuryNews(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const news = bundle.news;
  const status = news?.playerStatus ?? inferStatus(prop.injuryStatus);
  if (!news && !status) {
    return {
      ...neutral(),
      warnings: ["No injury confirmation available — status unverified."],
    };
  }
  const res = neutral();
  res.hasData = Boolean(news) || Boolean(status);
  let acc = 50;
  const parts: string[] = [];

  switch (status) {
    case "out":
      acc -= 45;
      res.warnings.push("Player is reported OUT — pick should be avoided unless overridden.");
      res.reasonsAgainst.push("Player currently listed as OUT.");
      break;
    case "doubtful":
      acc -= 22;
      res.warnings.push("Player is DOUBTFUL — elevated risk of no play / reduced role.");
      res.reasonsAgainst.push("Doubtful injury status.");
      break;
    case "questionable":
    case "gtd":
      acc -= 10;
      res.warnings.push("Player is QUESTIONABLE/GTD — confirm active before entry.");
      res.reasonsAgainst.push("Questionable tag adds availability risk.");
      break;
    case "active":
      acc += 6;
      break;
  }
  if (status) parts.push(`Status: ${status}.`);
  if (news?.lineupConfirmed) {
    acc += 8;
    parts.push("Lineup/role confirmed.");
    res.reasonsFor.push("Lineup or role is confirmed.");
  }
  for (const n of news?.notes ?? []) parts.push(n.summary);

  res.score = clamp(acc, 0, 100);
  res.evidence.push({
    category: "injuryNews",
    title: "Injury & news context",
    summary: parts.join(" ") || "No material injury/news signal.",
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: news?.source ?? (prop.injuryStatus ? "manual/demo data" : "manual/demo data"),
    sourceUrl: news?.notes?.[0]?.sourceUrl,
  });
  return res;
}

function inferStatus(raw?: string | null): PlayerStatus | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s.includes("out")) return "out";
  if (s.includes("doubt")) return "doubtful";
  if (s.includes("quest") || s.includes("gtd") || s.includes("game-time")) return "questionable";
  if (s.includes("active") || s.includes("probable") || s.includes("confirmed")) return "active";
  return undefined;
}

function scoreMarketEdge(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): { result: CategoryResult; edgeScore: number } {
  const market = bundle.market;
  const projection = market?.projection ?? prop.projection ?? undefined;
  const comps = market?.comparableLines ?? [];
  const pOver = market?.noVigProbOver;
  // The no-vig probability is only valid at the market's own line. When we're
  // scoring a different line (an entered Underdog line), fall back to the
  // projection-vs-line edge so softness is measured against the line you bet.
  const noVigApplicable =
    pOver != null &&
    (market?.marketLine == null || Math.abs(prop.line - market.marketLine) <= 0.25);
  if (projection == null && comps.length === 0 && pOver == null) {
    return {
      result: {
        ...neutral(),
        warnings: ["No market comparison available — projected edge not computed."],
      },
      edgeScore: 0,
    };
  }
  const res = neutral();
  res.hasData = true;
  let edge = 0;
  const parts: string[] = [];

  if (projection != null) {
    edge = dirSign(prop.direction) * (projection - prop.line);
    parts.push(`Market-implied projection ${projection.toFixed(1)} vs line ${prop.line}.`);
  }
  if (comps.length) {
    const avgComp = mean(comps);
    // For an OVER, a higher market line elsewhere means our line is soft (good).
    const softness = dirSign(prop.direction) * (avgComp - prop.line);
    edge = edge === 0 ? softness : (edge + softness) / 2;
    if (Math.abs(avgComp - prop.line) >= Math.max(0.5, prop.line * 0.03)) {
      parts.push(
        avgComp > prop.line
          ? "This line looks soft vs the market."
          : "This line looks sharp vs the market.",
      );
    }
  }

  const scale = Math.max(prop.line * 0.12, 0.75);
  let score = marginToScore(edge, scale);

  // The de-vigged market probability is the strongest single market signal.
  if (noVigApplicable && pOver != null) {
    const pFavored = prop.direction === "OVER" ? pOver : 1 - pOver;
    const probScore = clamp(50 + (pFavored - 0.5) * 300, 0, 100);
    // Let the no-vig probability drive the market sub-score.
    score = probScore;
    parts.unshift(
      `Market no-vig win probability ${(pFavored * 100).toFixed(1)}%` +
        (market?.bookCount ? ` across ${market.bookCount} book(s).` : "."),
    );
    if (pFavored >= 0.55)
      res.reasonsFor.push(`Sharp market gives the ${overUnderWord(prop.direction)} a ${(pFavored * 100).toFixed(0)}% no-vig win probability.`);
    if (pFavored <= 0.47)
      res.reasonsAgainst.push(`Market no-vig probability (${(pFavored * 100).toFixed(0)}%) does not favor this side.`);
  }

  res.score = score;
  res.evidence.push({
    category: "marketEdge",
    title: noVigApplicable
      ? `Market lean ${(((prop.direction === "OVER" ? pOver! : 1 - pOver!)) * 100).toFixed(0)}% (no-vig)`
      : `Projected edge ${edge >= 0 ? "+" : ""}${edge.toFixed(1)}`,
    summary: parts.join(" "),
    confidenceImpact: Math.round((res.score - 50) / 3),
    sourceName: market?.source ?? "manual/demo data",
  });
  if (!noVigApplicable && edge > scale * 0.4)
    res.reasonsFor.push(`Line offers a projected edge of ${edge.toFixed(1)} in your direction.`);
  if (!noVigApplicable && edge < -scale * 0.4)
    res.reasonsAgainst.push(`Market/projection implies negative edge (${edge.toFixed(1)}).`);
  return { result: res, edgeScore: edge };
}

function scoreSentiment(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const s = bundle.sentiment;
  if (!s || s.score == null) {
    return {
      ...neutral(),
      warnings: ["No credible expert/market discussion captured."],
    };
  }
  const res = neutral();
  res.hasData = true;
  const aligned = dirSign(prop.direction) * s.score; // -1..1
  const credibility = clamp((s.credibleSourceCount ?? 1) / 4, 0.25, 1);
  res.score = clamp(50 + aligned * 40 * credibility, 0, 100);
  res.evidence.push({
    category: "sentiment",
    title: `Expert/market sentiment ${aligned > 0.1 ? "supports" : aligned < -0.1 ? "opposes" : "is mixed on"} the ${overUnderWord(prop.direction)}`,
    summary:
      (s.notes?.map((n) => n.summary).join(" ") ||
        "Aggregated discussion signal.") +
      ` (${s.credibleSourceCount ?? 1} credible source(s)).`,
    confidenceImpact: Math.round((res.score - 50) / 4),
    sourceName: s.source,
    sourceUrl: s.notes?.[0]?.sourceUrl,
  });
  return res;
}

function scoreHistoricalSplits(
  prop: ScorablePropInput,
  bundle: ResearchBundle,
): CategoryResult {
  const h = bundle.historical;
  if (!h) {
    return { ...neutral(), warnings: ["No historical split/matchup data available."] };
  }
  const res = neutral();
  res.hasData = true;
  let acc = 50;
  const parts: string[] = [];

  if (h.vsOpponentAverage != null) {
    const favor = dirSign(prop.direction) * (h.vsOpponentAverage - prop.line);
    acc += clamp(favor / Math.max(1, prop.line * 0.2), -1, 1) * 22;
    parts.push(`Averages ${h.vsOpponentAverage.toFixed(1)} vs this opponent historically.`);
  }
  if (h.backToBack) {
    acc += prop.direction === "OVER" ? -6 : 6;
    parts.push("On a back-to-back / short rest.");
  }
  if (h.restDays != null && h.restDays >= 2) {
    acc += prop.direction === "OVER" ? 3 : -3;
    parts.push(`${h.restDays} days rest.`);
  }
  if (h.weatherConcern) {
    acc += prop.direction === "OVER" ? -8 : 6;
    parts.push("Weather could suppress output.");
    res.warnings.push("Weather flagged as a potential factor for this outdoor game.");
  }
  if (h.ballparkFactor != null) {
    const bp = (h.ballparkFactor - 1) * 100;
    acc += (prop.direction === "OVER" ? 1 : -1) * clamp(bp, -10, 10);
    parts.push(`Ballpark factor ${h.ballparkFactor.toFixed(2)}.`);
  }
  res.score = clamp(acc, 0, 100);
  res.evidence.push({
    category: "historicalSplits",
    title: "Historical splits",
    summary: parts.join(" ") || "Limited historical detail.",
    confidenceImpact: Math.round((res.score - 50) / 4),
    sourceName: h.source,
  });
  return res;
}

// ---- Main engine --------------------------------------------------------

export function analyzeProp(
  prop: ScorablePropInput,
  bundle: ResearchBundle = {},
  opts: { profile?: ScoringProfile } = {},
): PickAnalysis {
  const profile: ScoringProfile = opts.profile ?? "balanced";
  const recentForm = scoreRecentForm(prop, bundle);
  const seasonBaseline = scoreSeasonBaseline(prop, bundle);
  const matchup = scoreMatchup(prop, bundle);
  const roleUsage = scoreRoleUsage(prop, bundle);
  const injuryNews = scoreInjuryNews(prop, bundle);
  const { result: marketEdge, edgeScore } = scoreMarketEdge(prop, bundle);
  const sentiment = scoreSentiment(prop, bundle);
  const historicalSplits = scoreHistoricalSplits(prop, bundle);

  // Volatility drives parlay suitability & risk.
  const games = bundle.playerStats?.recentGames ?? [];
  const sd = bundle.playerStats?.seasonStdDev ?? stdDev(games);
  const volatilityRatio = prop.line > 0 ? sd / prop.line : 0.4;

  const inputCats = [
    recentForm,
    seasonBaseline,
    matchup,
    roleUsage,
    injuryNews,
    marketEdge,
    sentiment,
    historicalSplits,
  ];
  const completeness =
    inputCats.filter((c) => c.hasData).length / inputCats.length;

  // Parlay suitability: safe legs are complete-data, low-volatility, confident.
  const parlaySuit = clamp(
    45 +
      (0.5 - clamp(volatilityRatio, 0, 1)) * 40 +
      (completeness - 0.5) * 30,
    0,
    100,
  );
  const parlaySuitability: CategoryResult = {
    score: parlaySuit,
    hasData: true,
    evidence: [
      {
        category: "dataQuality",
        title: `Parlay suitability ${parlaySuit >= 60 ? "good" : parlaySuit >= 45 ? "fair" : "weak"}`,
        summary: `Based on ${(volatilityRatio * 100).toFixed(0)}% volatility and ${(completeness * 100).toFixed(
          0,
        )}% data completeness.`,
        confidenceImpact: 0,
        sourceName: "PropEdge model",
      },
    ],
    warnings: [],
    reasonsFor: [],
    reasonsAgainst: [],
  };

  const breakdown: ScoreBreakdown = {
    recentForm: round1(recentForm.score),
    seasonBaseline: round1(seasonBaseline.score),
    matchup: round1(matchup.score),
    roleUsage: round1(roleUsage.score),
    injuryNews: round1(injuryNews.score),
    marketEdge: round1(marketEdge.score),
    sentiment: round1(sentiment.score),
    historicalSplits: round1(historicalSplits.score),
    parlaySuitability: round1(parlaySuitability.score),
  };

  const catResults: Record<ScoreCategory, CategoryResult> = {
    recentForm,
    seasonBaseline,
    matchup,
    roleUsage,
    injuryNews,
    marketEdge,
    sentiment,
    historicalSplits,
    parlaySuitability,
  };
  const weights = weightsForProfile(profile);
  // Renormalize over categories that actually have data, so absent categories
  // don't drag the score toward 50 (they're accounted for via `dampen` below).
  let wNum = 0;
  let wDen = 0;
  for (const cat of Object.keys(weights) as ScoreCategory[]) {
    if (catResults[cat].hasData) {
      wNum += weights[cat] * breakdown[cat];
      wDen += weights[cat];
    }
  }
  const rawWeighted = wDen > 0 ? wNum / wDen : 50;
  // Dampen distance from 50 as input data gets sparser — honesty about uncertainty.
  const dampen = 0.55 + 0.45 * completeness;
  const confidenceScore = Math.round(clamp(50 + (rawWeighted - 50) * dampen, 0, 100));

  const allCats = [...inputCats, parlaySuitability];
  const evidence = allCats.flatMap((c) => c.evidence);
  const warnings = allCats.flatMap((c) => c.warnings);
  const reasonsFor = dedupe(allCats.flatMap((c) => c.reasonsFor));
  const reasonsAgainst = dedupe(allCats.flatMap((c) => c.reasonsAgainst));

  if (completeness < 0.5) {
    warnings.push(
      "Confidence reduced due to missing data — manual review recommended before entry.",
    );
  }

  const riskLevel = deriveRiskLevel(confidenceScore, volatilityRatio, completeness);
  const tags = buildTags(breakdown, riskLevel, bundle, prop, volatilityRatio);
  const { reasoningSummary, deepDiveAnalysis, verdict } = buildNarrative(
    prop,
    confidenceScore,
    edgeScore,
    riskLevel,
    reasonsFor,
    reasonsAgainst,
    completeness,
  );

  return {
    confidenceScore,
    edgeScore: round1(edgeScore),
    riskLevel,
    scoreBreakdown: breakdown,
    evidence,
    warnings: dedupe(warnings),
    reasonsFor,
    reasonsAgainst,
    reasoningSummary,
    deepDiveAnalysis,
    verdict,
    tags,
    dataCompleteness: round1(completeness),
  };
}

// ---- Narrative & tags ---------------------------------------------------

function buildTags(
  b: ScoreBreakdown,
  risk: string,
  bundle: ResearchBundle,
  prop: ScorablePropInput,
  volatilityRatio: number,
): string[] {
  const tags = new Set<string>();
  if (b.recentForm >= 62) tags.add("hot streak");
  if (b.roleUsage >= 62) tags.add("volume play");
  if (bundle.news?.teammateAbsencesBoost && prop.direction === "OVER") tags.add("injury boost");
  if (b.matchup >= 62) tags.add("matchup edge");
  if (b.marketEdge >= 62) tags.add("market edge");
  if (risk === "High" || volatilityRatio > 0.5) tags.add("risky");
  if (b.seasonBaseline >= 62) tags.add("baseline lean");
  return [...tags];
}

function buildNarrative(
  prop: ScorablePropInput,
  confidence: number,
  edge: number,
  risk: string,
  reasonsFor: string[],
  reasonsAgainst: string[],
  completeness: number,
) {
  const ou = overUnderWord(prop.direction);
  let strength: string;
  if (confidence >= 78) strength = `Strong ${ou} lean`;
  else if (confidence >= 68) strength = `${cap(ou)} lean`;
  else if (confidence >= 58) strength = `Slight ${ou} lean`;
  else strength = `Marginal ${ou} — closer to a pass`;

  const support = reasonsFor.slice(0, 3).join("; ") || "limited positive signal";
  const risksText =
    reasonsAgainst.slice(0, 3).join("; ") ||
    "standard game-flow variance (blowout risk, role changes)";

  const reasoningSummary = `${strength} at ${confidence}/100 model confidence. Supported by ${support}. Main risks: ${risksText}.`;

  const deepDiveAnalysis =
    `The model scores this ${prop.playerName} ${prop.direction} ${prop.line} ${prop.propType} at ${confidence}/100 ` +
    `with a projected edge of ${edge >= 0 ? "+" : ""}${edge.toFixed(1)} and ${risk.toLowerCase()} risk. ` +
    `Positive drivers: ${support}. Countervailing factors: ${risksText}. ` +
    (completeness < 0.6
      ? "Note: several research inputs were unavailable, so treat this confidence as provisional and verify before any entry. "
      : "") +
    `Sports outcomes are uncertain — this is research, not financial advice.`;

  const verdict = `Verdict: ${strength}. ${
    reasonsFor.length
      ? `The pick is supported by ${support}.`
      : "Support is thin — manual review recommended."
  } Primary risks are ${risksText}. All picks carry risk.`;

  return { reasoningSummary, deepDiveAnalysis, verdict };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
