import "server-only";
import type { PlayerProp } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { analyzeProp, SCORING_MODEL_VERSION } from "@/lib/analysis/scoringEngine";
import { recommendedStake } from "@/lib/analysis/confidenceModel";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { prewarmMlb } from "@/lib/providers/live/mlbStats";
import { prewarmEspn } from "@/lib/providers/live/espnPlayerStats";
import type { Direction, ScorablePropInput } from "@/types";

const ESPN_STAT_SPORTS = new Set(["NBA", "WNBA", "NCAAB", "NFL", "NHL"]);

export function propToScorable(p: PlayerProp): ScorablePropInput {
  return {
    sport: p.sport,
    league: p.league,
    playerName: p.playerName,
    team: p.team,
    opponent: p.opponent,
    propType: p.propType,
    // Score against the Underdog line when the user has entered it (that's the
    // number actually being bet); otherwise use the sharp-market line.
    line: p.underdogLine ?? p.line,
    marketLine: p.line,
    direction: p.direction as Direction,
    projection: p.projection,
    injuryStatus: p.injuryStatus,
    date: p.date,
    gameId: p.gameId,
    marketDataJson: p.marketDataJson,
  };
}

export interface GenerationSummary {
  date: string;
  created: number;
  evaluated: number;
  /** Picks you had marked as taken that were carried through the re-rank. */
  restoredTaken?: number;
  filtered: { reason: string; count: number }[];
}

/**
 * Analyze every available prop for a date and persist the top picks.
 * Regenerates only PENDING picks (settled picks are preserved).
 */
export async function generatePicksForDate(date: string): Promise<GenerationSummary> {
  const settings = await getSettings();
  const enabled = new Set(settings.sportsEnabled.map((s) => s.toLowerCase()));

  const props = await prisma.playerProp.findMany({
    where: { date, status: "pending" },
  });

  // Picks you marked as taken must survive a re-rank. The marking belongs to the
  // prop, but the Pick row is recreated below (and its bankroll entry cascades
  // away with it), so capture both first and restore them after.
  const takenBefore = await prisma.pick.findMany({
    where: { date, status: "pending", placedReal: true },
    select: { playerPropId: true, bankrollEntries: { where: { entryType: "single" }, select: { stake: true, placedReal: true } } },
  });
  const takenStakes = new Map<string, { stake: number | null; placedReal: boolean }>();
  for (const t of takenBefore) {
    const entry = t.bankrollEntries[0];
    takenStakes.set(t.playerPropId, { stake: entry?.stake ?? null, placedReal: entry?.placedReal ?? true });
  }

  // Drop existing pending picks for the date so we can re-rank cleanly.
  await prisma.pick.deleteMany({ where: { date, status: "pending" } });

  // Pre-warm live game logs concurrently so the scoring loop hits cache.
  if (!settings.demoMode && settings.enableWebResearch) {
    const mlb = props.filter((p) => p.sport === "MLB");
    if (mlb.length > 0) {
      await prewarmMlb(
        mlb.map((p) => p.playerName),
        [...new Set(mlb.map((p) => p.propType))],
      );
    }
    const espn = props.filter((p) => ESPN_STAT_SPORTS.has(p.sport));
    if (espn.length > 0) {
      await prewarmEspn(
        espn.map((p) => ({
          sport: p.sport,
          league: p.league,
          playerName: p.playerName,
          team: p.team,
          opponent: p.opponent,
          propType: p.propType,
          date: p.date,
        })),
      );
    }
  }

  // Skip props that already have a settled pick (avoid duplicates).
  const settledPickProps = await prisma.pick.findMany({
    where: { date, status: { not: "pending" } },
    select: { playerPropId: true },
  });
  const alreadySettled = new Set(settledPickProps.map((p) => p.playerPropId));

  const filters: Record<string, number> = {
    "Sport disabled": 0,
    "Player OUT": 0,
    "Insufficient data / low volume": 0,
    "Below confidence threshold": 0,
    "Already has a settled pick": 0,
  };

  interface Candidate {
    prop: PlayerProp;
    analysis: ReturnType<typeof analyzeProp>;
    entryProb: number | null;
  }
  const candidates: Candidate[] = [];

  for (const prop of props) {
    if (alreadySettled.has(prop.id)) {
      filters["Already has a settled pick"]++;
      continue;
    }
    if (enabled.size > 0 && !enabled.has(prop.sport.toLowerCase())) {
      filters["Sport disabled"]++;
      continue;
    }

    const ctx = resolveProviderContext({
      propIsDemo: prop.isDemo,
      demoMode: settings.demoMode,
      enableWebResearch: settings.enableWebResearch,
    });
    const bundle = await buildResearchBundle(propToScorable(prop), ctx);
    const analysis = analyzeProp(propToScorable(prop), bundle, {
      profile: settings.scoringProfile,
    });

    // Filter: player ruled OUT (news or manual status), unless evidence overrides.
    const status = bundle.news?.playerStatus ?? inferOut(prop.injuryStatus);
    if (status === "out") {
      filters["Player OUT"]++;
      continue;
    }

    // Filter: low volume / insufficient data. A real market snapshot (no-vig
    // probability / projection) counts as sufficient on its own.
    const hasMarket =
      bundle.market?.noVigProbOver != null || bundle.market?.projection != null;
    const games = bundle.playerStats?.recentGames?.length ?? 0;
    if (!hasMarket && (analysis.dataCompleteness < 0.25 || (games > 0 && games < 3))) {
      filters["Insufficient data / low volume"]++;
      continue;
    }

    // Filter: below the configured minimum confidence.
    if (analysis.confidenceScore < settings.minConfidenceThreshold) {
      filters["Below confidence threshold"]++;
      continue;
    }

    // Remember whose team the player is actually on. `prop.team` is the home
    // side for Odds-API props, so it cannot answer "are these two team-mates?",
    // which pick'em entries are not allowed to contain.
    const resolvedTeamId = bundle.playerStats?.playerTeamId;
    if (resolvedTeamId && resolvedTeamId !== prop.playerTeamId) {
      await prisma.playerProp.update({ where: { id: prop.id }, data: { playerTeamId: resolvedTeamId } });
      prop.playerTeamId = resolvedTeamId;
    }

    // Entry line for CLV: no-vig probability of the chosen side at pick time.
    const entryProb = clvEntryProb(bundle.market?.noVigProbOver, prop.direction as Direction);
    candidates.push({ prop, analysis, entryProb });
  }

  candidates.sort(
    (a, b) =>
      b.analysis.confidenceScore - a.analysis.confidenceScore ||
      b.analysis.edgeScore - a.analysis.edgeScore,
  );

  const top = candidates.slice(0, settings.maxDailyPicks);

  let rank = 1;
  let restored = 0;
  for (const { prop, analysis, entryProb } of top) {
    const wasTaken = takenStakes.get(prop.id);
    const created = await prisma.pick.create({
      data: {
        playerPropId: prop.id,
        date,
        entryProb,
        placedReal: wasTaken != null,
        confidenceScore: analysis.confidenceScore,
        edgeScore: analysis.edgeScore,
        riskLevel: analysis.riskLevel,
        rank: rank++,
        recommendedStake: recommendedStake(analysis.riskLevel, settings.defaultStake),
        reasoningSummary: analysis.reasoningSummary,
        deepDiveAnalysis: analysis.deepDiveAnalysis,
        verdict: analysis.verdict,
        scoreBreakdownJson: JSON.stringify(analysis.scoreBreakdown),
        evidenceJson: JSON.stringify(analysis.evidence),
        warningsJson: JSON.stringify(analysis.warnings),
        reasonsForJson: JSON.stringify(analysis.reasonsFor),
        reasonsAgainstJson: JSON.stringify(analysis.reasonsAgainst),
        tagsJson: JSON.stringify(analysis.tags),
        modelVersion: SCORING_MODEL_VERSION,
        isDemo: prop.isDemo,
        evidence: {
          create: analysis.evidence.map((e) => ({
            category: e.category,
            title: e.title,
            summary: e.summary,
            sourceUrl: e.sourceUrl,
            sourceName: e.sourceName,
            confidenceImpact: e.confidenceImpact,
          })),
        },
      },
    });

    // Re-attach the bankroll entry that cascaded away with the old pick row.
    if (wasTaken) {
      await prisma.bankrollEntry.create({
        data: {
          date,
          pickId: created.id,
          entryType: "single",
          stake: wasTaken.stake ?? created.recommendedStake,
          payout: 0,
          profitLoss: 0,
          status: "pending",
          placedReal: wasTaken.placedReal,
          isDemo: prop.isDemo,
        },
      });
      restored++;
    }
  }

  // A pick you took that no longer clears the bar would silently vanish — say so.
  const droppedTaken = [...takenStakes.keys()].filter(
    (propId) => !top.some((t) => t.prop.id === propId),
  ).length;
  if (droppedTaken > 0) {
    filters[`Dropped from the board but you had taken ${droppedTaken}`] = droppedTaken;
  }

  return {
    date,
    created: top.length,
    restoredTaken: restored,
    evaluated: props.length,
    filtered: Object.entries(filters)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => ({ reason, count })),
  };
}

function inferOut(raw?: string | null): "out" | undefined {
  if (raw && raw.toLowerCase().includes("out")) return "out";
  return undefined;
}

/** No-vig probability of the chosen side (OVER or UNDER) for CLV tracking. */
export function clvEntryProb(
  noVigProbOver: number | null | undefined,
  direction: Direction,
): number | null {
  if (noVigProbOver == null || !Number.isFinite(noVigProbOver)) return null;
  return direction === "OVER" ? noVigProbOver : 1 - noVigProbOver;
}
