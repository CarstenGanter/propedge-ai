import type {
  BankrollEntry,
  Evidence,
  Parlay,
  ParlayLeg,
  Pick,
  PlayerProp,
  TeamParlay,
  TeamParlayLeg,
  TeamPick,
} from "@prisma/client";
import type {
  Direction,
  EvidenceItem,
  RiskLevel,
  ScoreBreakdown,
  SettlementStatus,
  TeamScoreBreakdown,
  TeamSide,
  TeamStatus,
} from "@/types";
import type { PickRecord } from "@/lib/analytics";

export interface SerializedProp {
  id: string;
  date: string;
  sport: string;
  league: string;
  playerName: string;
  team: string;
  opponent: string;
  gameStartTime: string | null;
  propType: string;
  line: number;
  underdogLine: number | null;
  marketLine: number | null;
  marketProjection: number | null;
  direction: Direction;
  source: string;
  projection: number | null;
  payoutMultiplier: number | null;
  injuryStatus: string | null;
  notes: string | null;
  status: SettlementStatus;
  actualResult: number | null;
  isDemo: boolean;
}

export interface SerializedPick {
  id: string;
  playerPropId: string;
  date: string;
  confidenceScore: number;
  edgeScore: number;
  riskLevel: RiskLevel;
  rank: number;
  recommendedStake: number;
  reasoningSummary: string;
  deepDiveAnalysis: string;
  verdict: string;
  scoreBreakdown: ScoreBreakdown;
  evidence: EvidenceItem[];
  warnings: string[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  tags: string[];
  userNote: string | null;
  modelVersion: string;
  status: SettlementStatus;
  actualResult: number | null;
  placedReal: boolean;
  isDemo: boolean;
  /** Value of the entered Underdog line vs the sharp-market fair value (>0 = soft). */
  underdogEdge: number | null;
  prop: SerializedProp;
}

/** Edge of the Underdog line vs the market's fair value (positive = favorable). */
export function computeUnderdogEdge(p: SerializedProp): number | null {
  if (p.underdogLine == null) return null;
  const reference = p.marketProjection ?? p.marketLine ?? p.line;
  const sign = p.direction === "OVER" ? 1 : -1;
  return Math.round(sign * (reference - p.underdogLine) * 10) / 10;
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function parseMarket(json: string | null): { marketLine: number | null; projection: number | null } {
  if (!json) return { marketLine: null, projection: null };
  try {
    const m = JSON.parse(json) as { marketLine?: number; projection?: number };
    return { marketLine: m.marketLine ?? null, projection: m.projection ?? null };
  } catch {
    return { marketLine: null, projection: null };
  }
}

export function serializeProp(p: PlayerProp): SerializedProp {
  const market = parseMarket(p.marketDataJson);
  return {
    id: p.id,
    date: p.date,
    sport: p.sport,
    league: p.league,
    playerName: p.playerName,
    team: p.team,
    opponent: p.opponent,
    gameStartTime: p.gameStartTime ? p.gameStartTime.toISOString() : null,
    propType: p.propType,
    line: p.line,
    underdogLine: p.underdogLine,
    marketLine: market.marketLine,
    marketProjection: market.projection,
    direction: p.direction as Direction,
    source: p.source,
    projection: p.projection,
    payoutMultiplier: p.payoutMultiplier,
    injuryStatus: p.injuryStatus,
    notes: p.notes,
    status: p.status as SettlementStatus,
    actualResult: p.actualResult,
    isDemo: p.isDemo,
  };
}

export function serializePick(
  pick: Pick & { playerProp: PlayerProp },
): SerializedPick {
  const prop = serializeProp(pick.playerProp);
  return {
    id: pick.id,
    playerPropId: pick.playerPropId,
    date: pick.date,
    confidenceScore: pick.confidenceScore,
    edgeScore: pick.edgeScore,
    riskLevel: pick.riskLevel as RiskLevel,
    rank: pick.rank,
    recommendedStake: pick.recommendedStake,
    reasoningSummary: pick.reasoningSummary,
    deepDiveAnalysis: pick.deepDiveAnalysis,
    verdict: pick.verdict,
    scoreBreakdown: safeParse<ScoreBreakdown>(pick.scoreBreakdownJson, {} as ScoreBreakdown),
    evidence: safeParse<EvidenceItem[]>(pick.evidenceJson, []),
    warnings: safeParse<string[]>(pick.warningsJson, []),
    reasonsFor: safeParse<string[]>(pick.reasonsForJson, []),
    reasonsAgainst: safeParse<string[]>(pick.reasonsAgainstJson, []),
    tags: safeParse<string[]>(pick.tagsJson, []),
    userNote: pick.userNote,
    modelVersion: pick.modelVersion,
    status: pick.status as SettlementStatus,
    actualResult: pick.actualResult,
    placedReal: pick.placedReal,
    isDemo: pick.isDemo,
    underdogEdge: computeUnderdogEdge(prop),
    prop,
  };
}

export function pickToRecord(pick: Pick & { playerProp: PlayerProp }): PickRecord {
  return {
    sport: pick.playerProp.sport,
    league: pick.playerProp.league,
    propType: pick.playerProp.propType,
    direction: pick.playerProp.direction as Direction,
    confidenceScore: pick.confidenceScore,
    status: pick.status as SettlementStatus,
    date: pick.date,
  };
}

export interface SerializedParlay {
  id: string;
  date: string;
  name: string;
  stake: number;
  payoutMultiplier: number;
  projectedPayout: number;
  actualPayout: number | null;
  profitLoss: number | null;
  status: string;
  placedReal: boolean;
  isDemo: boolean;
  legs: {
    id: string;
    pickId: string;
    status: string;
    playerName: string;
    propType: string;
    direction: Direction;
    line: number;
    confidenceScore: number;
  }[];
}

export function serializeParlay(
  parlay: Parlay & {
    legs: (ParlayLeg & { pick: Pick & { playerProp: PlayerProp } })[];
  },
): SerializedParlay {
  return {
    id: parlay.id,
    date: parlay.date,
    name: parlay.name,
    stake: parlay.stake,
    payoutMultiplier: parlay.payoutMultiplier,
    projectedPayout: parlay.projectedPayout,
    actualPayout: parlay.actualPayout,
    profitLoss: parlay.profitLoss,
    status: parlay.status,
    placedReal: parlay.placedReal,
    isDemo: parlay.isDemo,
    legs: parlay.legs.map((leg) => ({
      id: leg.id,
      pickId: leg.pickId,
      status: leg.status,
      playerName: leg.pick.playerProp.playerName,
      propType: leg.pick.playerProp.propType,
      direction: leg.pick.playerProp.direction as Direction,
      line: leg.pick.playerProp.line,
      confidenceScore: leg.pick.confidenceScore,
    })),
  };
}

export interface SerializedBankrollEntry {
  id: string;
  date: string;
  entryType: string;
  stake: number;
  payout: number;
  profitLoss: number;
  status: string;
  placedReal: boolean;
  notes: string | null;
  isDemo: boolean;
  pickId: string | null;
}

export interface SerializedTeamPick {
  id: string;
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  gameStartTime: string | null;
  recommendedSide: TeamSide;
  recommendedTeam: string;
  winProbability: number;
  marketWinProb: number;
  valueEdge: number;
  priceAmerican: number | null;
  confidenceScore: number;
  edgeScore: number;
  riskLevel: RiskLevel;
  rank: number;
  reasoningSummary: string;
  deepDiveAnalysis: string;
  verdict: string;
  scoreBreakdown: TeamScoreBreakdown;
  evidence: EvidenceItem[];
  warnings: string[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  tags: string[];
  userNote: string | null;
  modelVersion: string;
  status: TeamStatus;
  actualWinner: TeamSide | null;
  placedReal: boolean;
  isDemo: boolean;
}

export function serializeTeamPick(t: TeamPick): SerializedTeamPick {
  return {
    id: t.id,
    date: t.date,
    league: t.league,
    homeTeam: t.homeTeam,
    awayTeam: t.awayTeam,
    gameStartTime: t.gameStartTime ? t.gameStartTime.toISOString() : null,
    recommendedSide: t.recommendedSide as TeamSide,
    recommendedTeam: t.recommendedTeam,
    winProbability: t.winProbability,
    marketWinProb: t.marketWinProb,
    valueEdge: t.valueEdge,
    priceAmerican: t.priceAmerican,
    confidenceScore: t.confidenceScore,
    edgeScore: t.edgeScore,
    riskLevel: t.riskLevel as RiskLevel,
    rank: t.rank,
    reasoningSummary: t.reasoningSummary,
    deepDiveAnalysis: t.deepDiveAnalysis,
    verdict: t.verdict,
    scoreBreakdown: safeParse<TeamScoreBreakdown>(t.scoreBreakdownJson, {} as TeamScoreBreakdown),
    evidence: safeParse<EvidenceItem[]>(t.evidenceJson, []),
    warnings: safeParse<string[]>(t.warningsJson, []),
    reasonsFor: safeParse<string[]>(t.reasonsForJson, []),
    reasonsAgainst: safeParse<string[]>(t.reasonsAgainstJson, []),
    tags: safeParse<string[]>(t.tagsJson, []),
    userNote: t.userNote,
    modelVersion: t.modelVersion,
    status: t.status as TeamStatus,
    actualWinner: t.actualWinner as TeamSide | null,
    placedReal: t.placedReal,
    isDemo: t.isDemo,
  };
}

export interface SerializedTeamParlay {
  id: string;
  date: string;
  name: string;
  stake: number;
  combinedDecimal: number;
  combinedAmerican: number;
  projectedPayout: number;
  actualPayout: number | null;
  profitLoss: number | null;
  status: string;
  placedReal: boolean;
  isDemo: boolean;
  legs: {
    id: string;
    teamPickId: string;
    status: string;
    recommendedTeam: string;
    opponent: string;
    side: TeamSide;
    league: string;
    priceAmerican: number | null;
    confidenceScore: number;
  }[];
}

export function serializeTeamParlay(
  parlay: TeamParlay & { legs: (TeamParlayLeg & { teamPick: TeamPick })[] },
): SerializedTeamParlay {
  return {
    id: parlay.id,
    date: parlay.date,
    name: parlay.name,
    stake: parlay.stake,
    combinedDecimal: parlay.combinedDecimal,
    combinedAmerican: parlay.combinedAmerican,
    projectedPayout: parlay.projectedPayout,
    actualPayout: parlay.actualPayout,
    profitLoss: parlay.profitLoss,
    status: parlay.status,
    placedReal: parlay.placedReal,
    isDemo: parlay.isDemo,
    legs: parlay.legs.map((leg) => {
      const side = leg.teamPick.recommendedSide as TeamSide;
      return {
        id: leg.id,
        teamPickId: leg.teamPickId,
        status: leg.status,
        recommendedTeam: leg.teamPick.recommendedTeam,
        opponent: side === "HOME" ? leg.teamPick.awayTeam : leg.teamPick.homeTeam,
        side,
        league: leg.teamPick.league,
        priceAmerican: leg.priceAmerican ?? leg.teamPick.priceAmerican,
        confidenceScore: leg.teamPick.confidenceScore,
      };
    }),
  };
}

export function serializeBankrollEntry(e: BankrollEntry): SerializedBankrollEntry {
  return {
    id: e.id,
    date: e.date,
    entryType: e.entryType,
    stake: e.stake,
    payout: e.payout,
    profitLoss: e.profitLoss,
    status: e.status,
    placedReal: e.placedReal,
    notes: e.notes,
    isDemo: e.isDemo,
    pickId: e.pickId,
  };
}
