"use server";

import { revalidatePath } from "next/cache";
import { captureClosingLines } from "@/lib/captureLines";

/**
 * Capture closing lines for today's pending picks (for CLV). Team lines are
 * cheap; prop lines cost credits, so they're opt-in via `includeProps`.
 */
export async function captureClosingLinesAction(
  includeProps: boolean,
): Promise<{ ok: boolean; message: string }> {
  const r = await captureClosingLines({ includeProps });
  for (const p of ["/analytics", "/results", "/"]) revalidatePath(p);
  if (!r.ok) return { ok: false, message: r.error ?? "Capture failed." };
  const props = includeProps ? `, ${r.propPicksUpdated} prop pick(s)` : "";
  return {
    ok: true,
    message: `Captured closing lines: ${r.teamPicksUpdated} team pick(s)${props}. Credits remaining: ${r.creditsRemaining ?? "?"}.`,
  };
}
