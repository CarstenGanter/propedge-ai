"use server";

import { revalidatePath } from "next/cache";
import {
  estimateNflFetch,
  ingestNflSlate,
  prepareNflResearch,
  type NflFetchEstimate,
  type NflIngestSummary,
  type NflPrepareSummary,
} from "@/lib/nfl/ingest";
import { generatePicksForDate, type GenerationSummary } from "@/lib/generate";

function revalidateNfl() {
  for (const p of ["/nfl", "/picks", "/parlays", "/results", "/analytics", "/"]) revalidatePath(p);
}

/** Free: how many credits a fetch for this slate would cost, and whether it's allowed. */
export async function estimateNflFetchAction(date: string): Promise<NflFetchEstimate> {
  return estimateNflFetch(date);
}

/** Paid (Odds API): pull the slate's props, prep research, generate ranked picks. */
export async function fetchNflSlateAction(
  date: string,
  opts?: { includeTeamPicks?: boolean },
): Promise<NflIngestSummary> {
  const summary = await ingestNflSlate(date, { includeTeamPicks: opts?.includeTeamPicks });
  revalidateNfl();
  return summary;
}

/** Free: refresh game contexts (injury reports, odds, weather) + defense aggregates. */
export async function refreshNflContextAction(date: string): Promise<NflPrepareSummary> {
  const summary = await prepareNflResearch(date);
  revalidateNfl();
  return summary;
}

/** Free: re-run research + ranking on the props already stored for the slate. */
export async function generateNflPicksAction(date: string): Promise<GenerationSummary> {
  await prepareNflResearch(date);
  const summary = await generatePicksForDate(date);
  revalidateNfl();
  return summary;
}
