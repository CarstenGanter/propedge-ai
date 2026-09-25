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
  /** null clears the stored line and re-scores against the market line; omit to leave it. */
  line?: number | null;
  /** Underdog's per-pick payout tag (e.g. 0.85); null clears it; omit to leave it. */
  pickMultiplier?: number | null;
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
  const seenOnPlatform: string[] = [];
  for (const e of entries) {
    let ok = true;
    // A line change re-scores the pick; a payout tag does not change the
    // probability, only what the pick is worth, so it is a plain update.
    if (e.line !== undefined) {
      const r = await applyUnderdogLine(e.pickId, e.line).catch(() => ({ ok: false }));
      ok = r.ok;
    }
    if (ok && e.pickMultiplier !== undefined) {
      const pick = await prisma.pick.findUnique({ where: { id: e.pickId }, select: { playerPropId: true } });
      if (pick) {
        await prisma.playerProp.update({
          where: { id: pick.playerPropId },
          data: { underdogPickMultiplier: e.pickMultiplier },
        });
      } else ok = false;
    }
    if (ok) {
      updated++;
      // Typing a line or a tag means you read it off the platform, so the prop
      // is offered. Recorded here rather than asked for twice.
      if (e.line != null || e.pickMultiplier != null) seenOnPlatform.push(e.pickId);
    } else failed++;
  }
  if (seenOnPlatform.length > 0) {
    const picks = await prisma.pick.findMany({
      where: { id: { in: seenOnPlatform } },
      select: { playerPropId: true },
    });
    await prisma.playerProp.updateMany({
      where: { id: { in: picks.map((p) => p.playerPropId) } },
      data: { underdogAvailable: true },
    });
  }
  revalidateAll();
  revalidatePath("/nfl");
  return { ok: failed === 0, updated, failed };
}

/**
 * Record whether the pick'em platform posts this prop at all.
 *
 * Kept separate from the line so the two facts never get confused: a prop can
 * be offered at a line you have not typed in yet, and one you marked absent
 * should not silently come back the moment a line is entered. Pass null to undo.
 */
export async function setUnderdogAvailability(
  pickIds: string[],
  available: boolean | null,
): Promise<{ ok: boolean; updated: number }> {
  if (pickIds.length === 0) return { ok: true, updated: 0 };
  const picks = await prisma.pick.findMany({
    where: { id: { in: pickIds } },
    select: { playerPropId: true },
  });
  const r = await prisma.playerProp.updateMany({
    where: { id: { in: picks.map((p) => p.playerPropId) } },
    data: { underdogAvailable: available },
  });
  revalidateAll();
  revalidatePath("/nfl");
  return { ok: true, updated: r.count };
}

export async function deletePickAction(pickId: string): Promise<{ ok: boolean }> {
  await prisma.pick.delete({ where: { id: pickId } });
  revalidateAll();
  return { ok: true };
}
