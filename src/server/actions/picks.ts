"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { generatePicksForDate, propToScorable, type GenerationSummary } from "@/lib/generate";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { analyzeProp, SCORING_MODEL_VERSION } from "@/lib/analysis/scoringEngine";
import { recommendedStake } from "@/lib/analysis/confidenceModel";
import { getSettings } from "@/lib/settings";
import { todaySlate } from "@/lib/utils/dates";

function revalidateAll() {
  for (const p of ["/", "/picks", "/research", "/results", "/analytics", "/parlays"]) {
    revalidatePath(p);
  }
}

export async function generateTodaysPicks(date?: string): Promise<GenerationSummary> {
  const slate = date ?? todaySlate();
  const summary = await generatePicksForDate(slate);
  revalidateAll();
  return summary;
}

export async function updatePickNote(
  pickId: string,
  note: string,
): Promise<{ ok: boolean }> {
  await prisma.pick.update({ where: { id: pickId }, data: { userNote: note } });
  revalidatePath(`/picks/${pickId}`);
  revalidatePath("/picks");
  return { ok: true };
}

export async function updatePickTags(
  pickId: string,
  tags: string[],
): Promise<{ ok: boolean }> {
  await prisma.pick.update({
    where: { id: pickId },
    data: { tagsJson: JSON.stringify(tags) },
  });
  revalidatePath(`/picks/${pickId}`);
  revalidatePath("/picks");
  return { ok: true };
}

/**
 * Set (or clear) the Underdog line for a pick's prop and re-score the pick
 * against that line — so confidence and recent-form hit rate reflect the number
 * you actually bet, and the market edge surfaces where Underdog is soft.
 */
export async function setUnderdogLine(
  pickId: string,
  underdogLine: number | null,
): Promise<{ ok: boolean }> {
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
  const updatedProp = { ...pick.playerProp, underdogLine };
  const scorable = propToScorable(updatedProp);
  const ctx = resolveProviderContext({
    propIsDemo: pick.isDemo,
    demoMode: settings.demoMode,
    enableWebResearch: settings.enableWebResearch,
  });
  const bundle = await buildResearchBundle(scorable, ctx);
  const analysis = analyzeProp(scorable, bundle, { profile: settings.scoringProfile });

  // Tag the Underdog line's value relative to the sharp market.
  const reference =
    bundle.market?.projection ?? bundle.market?.marketLine ?? pick.playerProp.line;
  const tags = new Set(analysis.tags);
  if (underdogLine != null) {
    const edge = (scorable.direction === "OVER" ? 1 : -1) * (reference - underdogLine);
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

  revalidatePath(`/picks/${pickId}`);
  revalidatePath("/picks");
  revalidatePath("/");
  return { ok: true };
}

export async function deletePickAction(pickId: string): Promise<{ ok: boolean }> {
  await prisma.pick.delete({ where: { id: pickId } });
  revalidateAll();
  return { ok: true };
}
