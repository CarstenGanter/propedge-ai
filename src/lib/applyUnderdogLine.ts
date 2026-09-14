import "server-only";
import { prisma } from "@/lib/db/client";
import { propToScorable } from "@/lib/generate";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { analyzeProp, SCORING_MODEL_VERSION } from "@/lib/analysis/scoringEngine";
import { recommendedStake } from "@/lib/analysis/confidenceModel";
import { getSettings } from "@/lib/settings";

/**
 * Store the line your pick'em app actually offers and re-score the pick against
 * it, because that number — not the sportsbook consensus — is what you play.
 * Shared by the single-pick editor and the bulk slate entry, neither of which
 * should revalidate per row.
 */
export async function applyUnderdogLine(
  pickId: string,
  underdogLine: number | null,
): Promise<{ ok: boolean; confidenceScore?: number; edge?: number | null }> {
  const pick = await prisma.pick.findUnique({
    where: { id: pickId },
    include: { playerProp: true },
  });
  if (!pick) return { ok: false };

  await prisma.playerProp.update({
    where: { id: pick.playerPropId },
    data: { underdogLine },
  });

  const settings = await getSettings();
  const scorable = propToScorable({ ...pick.playerProp, underdogLine });
  const ctx = resolveProviderContext({
    propIsDemo: pick.isDemo,
    demoMode: settings.demoMode,
    enableWebResearch: settings.enableWebResearch,
  });
  const bundle = await buildResearchBundle(scorable, ctx);
  const analysis = analyzeProp(scorable, bundle, { profile: settings.scoringProfile });

  // Tag the entered line's value relative to the sharp market. Line vs line —
  // never against the synthesised "projection", which is the market's lean in
  // disguise and is nonzero even when the two lines are identical.
  const reference = bundle.market?.marketLine ?? pick.playerProp.line;
  const tags = new Set(analysis.tags);
  let edge: number | null = null;
  if (underdogLine != null) {
    edge = Math.round((scorable.direction === "OVER" ? 1 : -1) * (reference - underdogLine) * 10) / 10;
    if (edge >= 0.4) tags.add("underdog value");
    else if (edge <= -0.4) tags.add("underdog trap");
  }

  await prisma.pick.update({
    where: { id: pickId },
    data: {
      confidenceScore: analysis.confidenceScore,
      edgeScore: analysis.edgeScore,
      riskLevel: analysis.riskLevel,
      recommendedStake: recommendedStake(analysis.riskLevel, settings.defaultStake),
      reasoningSummary: analysis.reasoningSummary,
      deepDiveAnalysis: analysis.deepDiveAnalysis,
      verdict: analysis.verdict,
      scoreBreakdownJson: JSON.stringify(analysis.scoreBreakdown),
      evidenceJson: JSON.stringify(analysis.evidence),
      warningsJson: JSON.stringify(analysis.warnings),
      reasonsForJson: JSON.stringify(analysis.reasonsFor),
      reasonsAgainstJson: JSON.stringify(analysis.reasonsAgainst),
      tagsJson: JSON.stringify([...tags]),
      modelVersion: SCORING_MODEL_VERSION,
    },
  });

  return { ok: true, confidenceScore: analysis.confidenceScore, edge };
}
