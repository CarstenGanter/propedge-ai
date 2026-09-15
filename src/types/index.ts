// ------------------------------------------------------------------
// Shared domain types & constants for PropEdge AI
// SQLite has no enums, so these string unions are the source of truth.
// ------------------------------------------------------------------

export const SPORTS = [
  "NFL",
  "NBA",
  "NCAAB",
  "MLB",
  "WNBA",
  "NHL",
  "Soccer",
] as const;
export type Sport = (typeof SPORTS)[number];

export const SPORT_LABELS: Record<Sport, string> = {
  NFL: "NFL / Football",
  NBA: "NBA",
  NCAAB: "NCAA Basketball",
  MLB: "MLB / Baseball",
  WNBA: "WNBA",
  NHL: "NHL",
  Soccer: "Soccer",
};

/** Common prop types per sport — used by the manual entry form & demo data. */
export const PROP_TYPES: Record<Sport, string[]> = {
  NFL: [
    "Passing Yards",
    "Rushing Yards",
    "Receiving Yards",
    "Receptions",
    "Pass TDs",
    "Completions",
    "Rush+Rec Yards",
    "Pass Attempts",
    "Rush Attempts",
  ],
  NBA: ["Points", "Rebounds", "Assists", "Pts+Reb+Ast", "3-Pointers Made", "Steals+Blocks"],
  NCAAB: ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Reb+Ast"],
  MLB: ["Total Bases", "Hits", "Strikeouts", "RBIs", "Runs", "Hits+Runs+RBIs"],
  WNBA: ["Points", "Rebounds", "Assists", "Pts+Reb+Ast", "3-Pointers Made"],
  NHL: ["Shots on Goal", "Points", "Goals", "Assists", "Saves", "Blocked Shots"],
  Soccer: ["Shots", "Shots on Target", "Passes", "Tackles", "Goals + Assists"],
};

/**
 * NFL prop markets selectable for The Odds API pulls. Each market costs one
 * credit per game, so the default set is the six with the most pick'em value.
 */
export const NFL_MARKET_OPTIONS: { propType: string; note: string; defaultOn: boolean }[] = [
  { propType: "Passing Yards", note: "QB volume; weather-sensitive", defaultOn: true },
  { propType: "Rushing Yards", note: "RB workload", defaultOn: true },
  { propType: "Receiving Yards", note: "WR/TE production", defaultOn: true },
  { propType: "Receptions", note: "Low variance, PPR-style", defaultOn: true },
  { propType: "Pass TDs", note: "High variance", defaultOn: true },
  { propType: "Rush+Rec Yards", note: "Combined yardage (popular on Underdog)", defaultOn: true },
  { propType: "Completions", note: "QB volume; steady", defaultOn: false },
  { propType: "Pass Attempts", note: "Pure volume", defaultOn: false },
  { propType: "Rush Attempts", note: "Pure volume", defaultOn: false },
];
export const NFL_DEFAULT_MARKETS: readonly string[] = NFL_MARKET_OPTIONS.filter((m) => m.defaultOn).map(
  (m) => m.propType,
);

export type Direction = "OVER" | "UNDER";
export const DIRECTIONS: Direction[] = ["OVER", "UNDER"];

/** Settlement status shared by props, picks and parlay legs. */
export type SettlementStatus = "pending" | "hit" | "miss" | "push" | "void";
export const SETTLEMENT_STATUSES: SettlementStatus[] = [
  "pending",
  "hit",
  "miss",
  "push",
  "void",
];

/** Bankroll / parlay financial status. */
export type WagerStatus = "pending" | "won" | "lost" | "push" | "void";

export type RiskLevel = "Low" | "Medium" | "High";

export type EntryType = "single" | "parlay" | "manual_adjustment";

export const MODEL_VERSION = "v1.0.0";

// ---- Scoring engine contract ----

export type ScoreCategory =
  | "recentForm"
  | "seasonBaseline"
  | "matchup"
  | "roleUsage"
  | "injuryNews"
  | "marketEdge"
  | "sentiment"
  | "historicalSplits"
  | "parlaySuitability";

export type ScoreBreakdown = Record<ScoreCategory, number>;

/**
 * Weight (0..1) each category contributes to the final confidence score.
 *
 * `parlaySuitability` is weighted 0 on purpose. It scores volatility and data
 * completeness, which say nothing about *which side* of the line is right, so
 * including it pushed the OVER and the UNDER of the same prop up together and
 * broke the requirement that the two sides sum to 100. It is still computed and
 * displayed, and it still drives risk labelling and slip suitability.
 */
export const CATEGORY_WEIGHTS: Record<ScoreCategory, number> = {
  recentForm: 0.21,
  seasonBaseline: 0.16,
  matchup: 0.16,
  roleUsage: 0.16,
  injuryNews: 0.105,
  marketEdge: 0.105,
  sentiment: 0.05,
  historicalSplits: 0.05,
  parlaySuitability: 0,
};

/**
 * `distribution` does not blend category scores at all: it estimates the
 * player's per-game distribution and reads P(stat beats the line) off the tail,
 * so the number it produces is an actual probability. The categories are still
 * scored and displayed as evidence.
 */
export type ScoringProfile = "balanced" | "market" | "distribution";

/**
 * "Market model" weights: confidence is driven mostly by the de-vigged market
 * signal (used when The Odds API is your primary source and player stats aren't
 * wired yet). Weights sum to 1.
 */
export const MARKET_PROFILE_WEIGHTS: Record<ScoreCategory, number> = {
  recentForm: 0.1,
  seasonBaseline: 0.08,
  matchup: 0.07,
  roleUsage: 0.05,
  injuryNews: 0.08,
  marketEdge: 0.57,
  sentiment: 0.02,
  historicalSplits: 0.03,
  parlaySuitability: 0,
};

export function weightsForProfile(profile: ScoringProfile): Record<ScoreCategory, number> {
  // The distribution profile ignores weights when scoring; these are the ones
  // shown in the breakdown so the evidence panel still reads sensibly.
  return profile === "market" ? MARKET_PROFILE_WEIGHTS : CATEGORY_WEIGHTS;
}

export const CATEGORY_LABELS: Record<ScoreCategory, string> = {
  recentForm: "Recent Form",
  seasonBaseline: "Season Baseline",
  matchup: "Matchup & Game Script",
  roleUsage: "Role & Usage",
  injuryNews: "Injury & News",
  marketEdge: "Market & Projection Edge",
  sentiment: "Sentiment & Expert Discussion",
  historicalSplits: "Historical Splits",
  parlaySuitability: "Parlay Suitability",
};

export type EvidenceCategory =
  | "recentForm"
  | "seasonBaseline"
  | "matchup"
  | "roleUsage"
  | "injuryNews"
  | "marketEdge"
  | "sentiment"
  | "historicalSplits"
  | "dataQuality";

export interface EvidenceItem {
  category: EvidenceCategory | string;
  title: string;
  summary: string;
  /** Direction & magnitude of impact on confidence, roughly -20..+20. */
  confidenceImpact: number;
  sourceUrl?: string;
  /** Named provider, or the label "manual/demo data" when unverified. */
  sourceName: string;
}

export interface PickAnalysis {
  confidenceScore: number; // 0..100
  edgeScore: number; // projected edge vs. the line (can be negative)
  riskLevel: RiskLevel;
  scoreBreakdown: ScoreBreakdown;
  evidence: EvidenceItem[];
  warnings: string[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  reasoningSummary: string;
  deepDiveAnalysis: string;
  verdict: string;
  tags: string[];
  dataCompleteness: number; // 0..1, share of categories with real inputs
}

// ---- Research inputs consumed by the scoring engine ----

export interface PlayerStatsContext {
  /** Per-game results for the prop's stat, most-recent first. */
  recentGames: number[];
  seasonAverage?: number;
  seasonMedian?: number;
  seasonStdDev?: number;
  gamesPlayed?: number;
  /** Usage-style metric relevant to the sport (minutes, snaps, TOI...). */
  usage?: number;
  usageTrend?: "up" | "down" | "steady";
  /** Share of team offensive snaps, 0..1 (NFL, from nflverse). */
  snapPct?: number;
  /** Share of team targets, 0..1 (NFL, from nflverse). */
  targetShare?: number;
  /** Weeks of role data behind snapPct/targetShare. */
  usageWeeks?: number;
  usageSource?: string;
  usageSourceUrl?: string;
  /** Games from the current season inside `recentGames` (rest are prior-season, if blended). */
  currentSeasonGames?: number;
  /** The player's own team, as the provider's canonical id (ESPN team id for NFL). */
  playerTeamId?: string;
  /** Factual disclosure about the sample, e.g. "Includes 2025 season games (1 of 2026 played)." */
  note?: string;
  source: string;
  sourceUrl?: string;
  isDemo?: boolean;
}

export interface MatchupContext {
  /** 1 = toughest defense vs this stat, 32 (or league size) = softest. */
  opponentDefenseRank?: number;
  leagueSize?: number;
  opponentAllowedAverage?: number;
  pace?: "fast" | "average" | "slow";
  /** Human-readable matchup note, e.g. "vs SP Gerrit Cole (2.90 ERA, 1.05 WHIP)". */
  opponentContext?: string;
  /**
   * Game environment (total + game script), already resolved for this pick's
   * direction: -1 works fully against it, +1 fully for it. Providers compute it
   * because the sport decides what a spread implies; the engine just weighs it.
   */
  environmentFavor?: number;
  environmentNote?: string;
  /** Set when the spread is lopsided enough that game script / resting is a risk. */
  blowoutRisk?: boolean;
  source: string;
  sourceUrl?: string;
  isDemo?: boolean;
}

export interface NewsContext {
  playerStatus?: "active" | "questionable" | "doubtful" | "out" | "gtd";
  teammateAbsencesBoost?: boolean; // absences that raise this player's opportunity
  lineupConfirmed?: boolean;
  notes?: { summary: string; sourceName: string; sourceUrl?: string }[];
  source: string;
  isDemo?: boolean;
}

export interface SentimentContext {
  /** -1 (bearish) .. +1 (bullish) relative to the OVER. */
  score?: number;
  credibleSourceCount?: number;
  notes?: { summary: string; sourceName: string; sourceUrl?: string }[];
  source: string;
  isDemo?: boolean;
}

export interface MarketContext {
  /** Comparable lines from other books for the same stat. */
  comparableLines?: number[];
  /** External model projection for the stat. */
  projection?: number;
  /** De-vigged market probability of the OVER (0..1), e.g. from The Odds API. */
  noVigProbOver?: number;
  /** The market's own consensus line (so we can tell if we're scoring a different line). */
  marketLine?: number;
  bookCount?: number;
  source: string;
  isDemo?: boolean;
}

export interface HistoricalSplitsContext {
  vsOpponentAverage?: number;
  homeAway?: "home" | "away";
  restDays?: number;
  backToBack?: boolean;
  weatherConcern?: boolean;
  /** Factual forecast text (or "indoor venue") — always shown, concern or not. */
  weatherNote?: string;
  ballparkFactor?: number; // MLB, 1.0 = neutral
  source: string;
  sourceUrl?: string;
  isDemo?: boolean;
}

export interface ResearchBundle {
  playerStats?: PlayerStatsContext;
  matchup?: MatchupContext;
  news?: NewsContext;
  sentiment?: SentimentContext;
  market?: MarketContext;
  historical?: HistoricalSplitsContext;
}

// ------------------------------------------------------------------
// Team Picks (moneyline / game-winner) vertical
// ------------------------------------------------------------------

export type TeamSide = "HOME" | "AWAY" | "DRAW";
export type TeamStatus = "pending" | "win" | "loss" | "push" | "void";

export const TEAM_MODEL_VERSION = "team-v1.1.0";

export type TeamScoreCategory =
  | "marketProb"
  | "form"
  | "injuries"
  | "homeAdvantage"
  | "value";

export type TeamScoreBreakdown = Record<TeamScoreCategory, number>;

export const TEAM_CATEGORY_WEIGHTS: Record<TeamScoreCategory, number> = {
  marketProb: 0.4,
  form: 0.25,
  injuries: 0.15,
  homeAdvantage: 0.1,
  value: 0.1,
};

export const TEAM_CATEGORY_LABELS: Record<TeamScoreCategory, string> = {
  marketProb: "Market Win Probability",
  form: "Recent Form & Record",
  injuries: "Injuries & Availability",
  homeAdvantage: "Home Advantage",
  value: "Value Edge",
};

/** De-vigged moneyline for a game (probabilities sum to ~1). */
export interface MoneylineOdds {
  homeTeam: string;
  awayTeam: string;
  homePrice?: number;
  awayPrice?: number;
  drawPrice?: number;
  homeProb: number;
  awayProb: number;
  drawProb: number; // 0 for 2-way sports
  bookCount: number;
  gameId?: string;
  commenceTime?: string;
  source: string;
}

export interface TeamForm {
  homeRecord?: string; // e.g. "49-39"
  awayRecord?: string;
  homeWinPct?: number; // 0..1
  awayWinPct?: number;
  // Richer form (MLB via standings; all optional so other leagues degrade gracefully).
  homeLast10Pct?: number;
  awayLast10Pct?: number;
  homeLast10Record?: string;
  awayLast10Record?: string;
  homeRunDiff?: number;
  awayRunDiff?: number;
  homeStreak?: string; // e.g. "W3"
  awayStreak?: string;
  source: string;
}

export interface TeamInjuries {
  homeKeyOut?: number;
  awayKeyOut?: number;
  notes?: { summary: string; sourceName: string }[];
  source: string;
}

/** Probable starting pitcher (MLB) with season rate stats. */
export interface ProbablePitcherInfo {
  name: string;
  era?: number;
  whip?: number;
}

export interface GameInput {
  league: string;
  homeTeam: string;
  awayTeam: string;
  threeWay: boolean;
  gameId?: string | null;
  commenceTime?: string | null;
  market?: MoneylineOdds;
  form?: TeamForm;
  injuries?: TeamInjuries;
  pitchers?: { home?: ProbablePitcherInfo; away?: ProbablePitcherInfo };
}

export interface TeamPickAnalysis {
  recommendedSide: TeamSide;
  recommendedTeam: string;
  winProbability: number; // 0..1 model
  marketWinProb: number; // 0..1 de-vig for the recommended side
  valueEdge: number; // model - market
  priceAmerican?: number;
  drawProbability?: number;
  confidenceScore: number; // 0..100
  edgeScore: number;
  riskLevel: RiskLevel;
  scoreBreakdown: TeamScoreBreakdown;
  evidence: EvidenceItem[];
  warnings: string[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  reasoningSummary: string;
  deepDiveAnalysis: string;
  verdict: string;
  tags: string[];
  dataCompleteness: number;
}

/** Minimal prop shape the scoring engine needs (subset of the Prisma model). */
export interface ScorablePropInput {
  sport: Sport | string;
  league: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  direction: Direction;
  projection?: number | null;
  injuryStatus?: string | null;
  /** The sharp-market consensus line (the prop's original line, when scoring an Underdog line). */
  marketLine?: number | null;
  /** Slate date "YYYY-MM-DD" — used for schedule/matchup lookups. */
  date?: string | null;
  /** External game id (ESPN event id when known) — lets providers skip schedule matching. */
  gameId?: string | null;
  /** JSON market snapshot stored on the prop (from The Odds API ingestion). */
  marketDataJson?: string | null;
}
