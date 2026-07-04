"use server";

import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { analyzeProp } from "@/lib/analysis/scoringEngine";
import { buildResearchBundle, resolveProviderContext } from "@/lib/providers";
import { propToScorable } from "@/lib/generate";
import type { PickAnalysis } from "@/types";

/** Run the scoring engine on a stored prop without persisting a pick. */
export async function analyzePropById(
  propId: string,
): Promise<{ ok: boolean; analysis?: PickAnalysis; error?: string }> {
  const prop = await prisma.playerProp.findUnique({ where: { id: propId } });
  if (!prop) return { ok: false, error: "Prop not found" };

  const settings = await getSettings();
  const ctx = resolveProviderContext({
    propIsDemo: prop.isDemo,
    demoMode: settings.demoMode,
    enableWebResearch: settings.enableWebResearch,
  });
  const bundle = await buildResearchBundle(propToScorable(prop), ctx);
  const analysis = analyzeProp(propToScorable(prop), bundle, {
    profile: settings.scoringProfile,
  });
  return { ok: true, analysis };
}
