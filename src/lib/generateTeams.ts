import "server-only";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { analyzeGame, TEAM_SCORING_MODEL_VERSION } from "@/lib/analysis/teamScoringEngine";
import { fetchMoneylines } from "@/lib/providers/live/theOddsApiTeams";
import { fetchGames, type GameRow } from "@/lib/providers/live/espnTeams";
import { fetchInjuries, type TeamInjuryInfo } from "@/lib/providers/live/espnInjuries";
import {
  getMlbStandings,
  getMlbProbableStarters,
  type MlbTeamForm,
  type ProbableStarter,
} from "@/lib/providers/live/mlbStats";
import { hasKey } from "@/lib/providers/config";
import { toSlateDate } from "@/lib/utils/dates";
import { teamsMatch, lookupTeam } from "@/lib/utils/teamName";
import { LEAGUE_CONFIG, isLeague, type League } from "@/lib/teamLeagues";
import type { GameInput, TeamForm, TeamInjuries } from "@/types";

export interface TeamGenerationSummary {
  date: string;
  created: number;
  evaluated: number;
  creditsRemaining: number | null;
  byLeague: { league: string; created: number; error?: string }[];
}

/** Build team form, preferring MLB standings (richer) and falling back to ESPN records. */
function buildForm(
  home: string,
  away: string,
  espn: GameRow | undefined,
  standings: Map<string, MlbTeamForm> | null,
): TeamForm | undefined {
  if (standings) {
    const h = lookupTeam(standings, home);
    const a = lookupTeam(standings, away);
    if (h || a) {
      return {
        homeRecord: h?.record ?? espn?.homeRecord,
        awayRecord: a?.record ?? espn?.awayRecord,
        homeWinPct: h?.winPct,
        awayWinPct: a?.winPct,
        homeLast10Pct: h?.last10Pct,
        awayLast10Pct: a?.last10Pct,
        homeLast10Record: h?.last10Record,
        awayLast10Record: a?.last10Record,
        homeRunDiff: h?.runDifferential,
        awayRunDiff: a?.runDifferential,
        homeStreak: h?.streakCode,
        awayStreak: a?.streakCode,
        source: "MLB Stats API",
      };
    }
  }
  if (espn && (espn.homeRecord || espn.awayRecord)) {
    return { homeRecord: espn.homeRecord, awayRecord: espn.awayRecord, source: "ESPN" };
  }
  return undefined;
}

/** Assemble injuries for a game from the league-wide ESPN injury map. */
function buildInjuries(
  home: string,
  away: string,
  injuries: Map<string, TeamInjuryInfo>,
): TeamInjuries | undefined {
  const h = lookupTeam(injuries, home);
  const a = lookupTeam(injuries, away);
  if (!h && !a) return undefined;
  const notes = [
    ...(h?.notes ?? []).map((n) => ({ summary: `${home}: ${n.summary}`, sourceName: n.sourceName })),
    ...(a?.notes ?? []).map((n) => ({ summary: `${away}: ${n.summary}`, sourceName: n.sourceName })),
  ];
  return { homeKeyOut: h?.keyOut ?? 0, awayKeyOut: a?.keyOut ?? 0, notes, source: "ESPN" };
}

/** Probable starters (MLB) for a game from the date-wide map. */
function buildPitchers(
  home: string,
  away: string,
  starters: Map<string, ProbableStarter> | null,
): GameInput["pitchers"] {
  if (!starters) return undefined;
  const h = lookupTeam(starters, home);
  const a = lookupTeam(starters, away);
  if (!h && !a) return undefined;
  return { home: h, away: a };
}

/** Fetch games+odds+form for enabled leagues, score them, and persist team picks. */
export async function generateTeamPicksForDate(date: string): Promise<TeamGenerationSummary> {
  const settings = await getSettings();
  const dateCompact = date.replace(/-/g, "");
  const leagues = settings.leaguesEnabled.filter(isLeague) as League[];

  const byLeague: TeamGenerationSummary["byLeague"] = [];
  let creditsRemaining: number | null = null;
  let evaluated = 0;

  interface Candidate {
    league: League;
    input: GameInput;
    analysis: ReturnType<typeof analyzeGame>;
  }
  const candidates: Candidate[] = [];

  if (!hasKey("ODDS_API_KEY")) {
    return { date, created: 0, evaluated: 0, creditsRemaining: null, byLeague: [] };
  }

  for (const league of leagues) {
    const ml = await fetchMoneylines(league, process.env.ODDS_API_KEY!);
    if (ml.creditsRemaining != null) creditsRemaining = ml.creditsRemaining;
    if (!ml.ok || ml.games.length === 0) {
      byLeague.push({ league, created: 0, error: ml.error ?? "No games (out of season?)" });
      continue;
    }

    const todays = ml.games.filter(
      (g) => g.commenceTime && toSlateDate(new Date(g.commenceTime)) === date,
    );
    if (todays.length === 0) {
      byLeague.push({ league, created: 0, error: "No games on this date" });
      continue;
    }

    // ESPN form/records for the date (best-effort).
    let espnGames: GameRow[] = [];
    try {
      espnGames = await fetchGames(league, dateCompact);
    } catch {
      espnGames = [];
    }
    const findEspn = (home: string, away: string) =>
      espnGames.find((e) => teamsMatch(e.homeTeam, home) && teamsMatch(e.awayTeam, away));

    // Richer, free data sources (fetched once per league; cached internally).
    const injuries = await fetchInjuries(league).catch(() => new Map<string, TeamInjuryInfo>());
    const standings = league === "MLB" ? await getMlbStandings().catch(() => null) : null;
    const starters = league === "MLB" ? await getMlbProbableStarters(date).catch(() => null) : null;

    let created = 0;
    for (const g of todays) {
      evaluated++;
      const espn = findEspn(g.homeTeam, g.awayTeam);
      const form = buildForm(g.homeTeam, g.awayTeam, espn, standings);
      const teamInjuries = buildInjuries(g.homeTeam, g.awayTeam, injuries);
      const pitchers = buildPitchers(g.homeTeam, g.awayTeam, starters);

      const input: GameInput = {
        league,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        threeWay: LEAGUE_CONFIG[league].threeWay,
        gameId: espn?.gameId ?? g.gameId,
        commenceTime: g.commenceTime,
        market: g,
        form,
        injuries: teamInjuries,
        pitchers,
      };
      const analysis = analyzeGame(input);
      if (analysis.confidenceScore < settings.minTeamConfidence) continue;
      candidates.push({ league, input, analysis });
      created++;
    }
    byLeague.push({ league, created });
  }

  // Replace pending non-demo team picks for the date, then persist ranked.
  await prisma.teamPick.deleteMany({ where: { date, status: "pending", isDemo: false } });

  candidates.sort(
    (a, b) =>
      b.analysis.confidenceScore + b.analysis.valueEdge * 100 -
      (a.analysis.confidenceScore + a.analysis.valueEdge * 100),
  );

  let rank = 1;
  for (const c of candidates) {
    const a = c.analysis;
    await prisma.teamPick.create({
      data: {
        date,
        league: c.league,
        homeTeam: c.input.homeTeam,
        awayTeam: c.input.awayTeam,
        gameId: c.input.gameId ?? null,
        gameStartTime: c.input.commenceTime ? new Date(c.input.commenceTime) : null,
        recommendedSide: a.recommendedSide,
        recommendedTeam: a.recommendedTeam,
        winProbability: a.winProbability,
        marketWinProb: a.marketWinProb,
        valueEdge: a.valueEdge,
        priceAmerican: a.priceAmerican ?? null,
        confidenceScore: a.confidenceScore,
        edgeScore: a.edgeScore,
        riskLevel: a.riskLevel,
        rank: rank++,
        reasoningSummary: a.reasoningSummary,
        deepDiveAnalysis: a.deepDiveAnalysis,
        verdict: a.verdict,
        scoreBreakdownJson: JSON.stringify(a.scoreBreakdown),
        evidenceJson: JSON.stringify(a.evidence),
        warningsJson: JSON.stringify(a.warnings),
        reasonsForJson: JSON.stringify(a.reasonsFor),
        reasonsAgainstJson: JSON.stringify(a.reasonsAgainst),
        tagsJson: JSON.stringify(a.tags),
        modelVersion: TEAM_SCORING_MODEL_VERSION,
        isDemo: false,
      },
    });
  }

  return { date, created: candidates.length, evaluated, creditsRemaining, byLeague };
}
