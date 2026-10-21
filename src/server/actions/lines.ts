"use server";

import { revalidatePath } from "next/cache";
import { captureClosingLines } from "@/lib/captureLines";
import { runAutoCapture } from "@/lib/nfl/runAutoCapture";
import { SPORTS } from "@/types";

/**
 * Capture closing lines for today's pending picks (for CLV). Team lines are
 * cheap; prop lines cost credits, so they're opt-in via `includeProps`.
 *
 * NFL prop lines go through the same pass as the schedulers (runAutoCapture):
 * only games 20-60 minutes from kickoff, under the shared lock, each game
 * bought once. A click at 10am used to stamp a 1pm game's "closing" line three
 * hours early (and the schedulers then skipped it as captured), or buy a game
 * the schedulers had just bought.
 */
export async function captureClosingLinesAction(
  includeProps: boolean,
): Promise<{ ok: boolean; message: string }> {
  const r = await captureClosingLines({ includeProps, sports: SPORTS.filter((s) => s !== "NFL") });
  const nfl = includeProps ? await runAutoCapture("manual") : null;
  for (const p of ["/analytics", "/results", "/"]) revalidatePath(p);
  if (!r.ok) return { ok: false, message: r.error ?? "Capture failed." };
  const props = includeProps ? `, ${r.propPicksUpdated} non-NFL prop pick(s)` : "";
  return {
    ok: true,
    message:
      `Captured closing lines: ${r.teamPicksUpdated} team pick(s)${props}. Credits remaining: ${r.creditsRemaining ?? "?"}.` +
      (nfl ? ` NFL props: ${nfl.replace(/^\[[^\]]*\] manual [^:]*: /, "")}` : ""),
  };
}
