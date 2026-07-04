"use server";

import { revalidatePath } from "next/cache";
import { ingestOddsPropsForSport, type OddsIngestResult } from "@/lib/oddsIngest";
import type { Sport } from "@/types";

/**
 * Fetch today's player props for a sport from The Odds API, de-vig them, and
 * store them as props (with a market snapshot) ready to generate picks from.
 */
export async function fetchPropsFromOddsApi(
  sport: Sport,
  maxEvents = 10,
): Promise<OddsIngestResult> {
  const result = await ingestOddsPropsForSport(sport, maxEvents);
  if (result.ok) {
    for (const p of ["/", "/picks", "/research", "/results"]) revalidatePath(p);
  }
  return result;
}
