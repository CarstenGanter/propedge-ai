"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { generatePicksForDate, type GenerationSummary } from "@/lib/generate";
import { applyUnderdogLine } from "@/lib/applyUnderdogLine";
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
  const r = await applyUnderdogLine(pickId, underdogLine);
  if (!r.ok) return { ok: false };
  revalidatePath(`/picks/${pickId}`);
  revalidatePath("/picks");
  revalidatePath("/nfl");
  revalidatePath("/");
  return { ok: true };
}

export interface UnderdogLineEntry {
  pickId: string;
  /** null clears the stored line and re-scores against the market line. */
  line: number | null;
}

/**
 * Save the whole slate's pick'em lines in one go and re-score each pick against
 * the number you actually play. Revalidates once at the end.
 */
export async function setUnderdogLines(
  entries: UnderdogLineEntry[],
): Promise<{ ok: boolean; updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  for (const e of entries) {
    const r = await applyUnderdogLine(e.pickId, e.line).catch(() => ({ ok: false }));
    if (r.ok) updated++;
    else failed++;
  }
  revalidateAll();
  revalidatePath("/nfl");
  return { ok: failed === 0, updated, failed };
}

export async function deletePickAction(pickId: string): Promise<{ ok: boolean }> {
  await prisma.pick.delete({ where: { id: pickId } });
  revalidateAll();
  return { ok: true };
}
