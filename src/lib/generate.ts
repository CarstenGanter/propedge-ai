import "server-only";
import type { PlayerProp } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { analyzeProp, SCORING_MODEL_VERSION } from "@/lib/analysis/scoringEngine";
import { recommendedStake } from "@/lib/analysis/confidenceModel";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { prewarmMlb } from "@/lib/providers/live/mlbStats";
import type { Direction, ScorablePropInput } from "@/types";

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
    marketDataJson: p.marketDataJson,
  };
}

export interface GenerationSummary {
  date: string;
  created: number;
  evaluated: number;
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

  // Drop existing pending picks for the date so we can re-rank cleanly.
  await prisma.pick.deleteMany({ where: { date, status: "pending" } });

  // Pre-warm live MLB game logs concurrently so the scoring loop hits cache.
  if (!settings.demoMode && settings.enableWebResearch) {
    const mlb = props.filter((p) => p.sport === "MLB");
    if (mlb.length > 0) {
      await prewarmMlb(
        mlb.map((p) => p.playerName),
        [...new Set(mlb.map((p) => p.propType))],
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
  for (const { prop, analysis, entryProb } of top) {
    await prisma.pick.create({
      data: {
        playerPropId: prop.id,
        date,
        entryProb,
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
  }

  return {
    date,
    created: top.length,
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
