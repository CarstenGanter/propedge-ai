"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { backupConfiguredDatabase } from "@/lib/db/backup";
import { saveSettings, type AppSettingsData } from "@/lib/settings";
import { seedDemoData, clearDemoDataPublic } from "@/lib/demoSeed";

function revalidateAll() {
  for (const p of ["/", "/picks", "/nfl", "/research", "/results", "/analytics", "/parlays", "/settings"]) {
    revalidatePath(p);
  }
}

export async function updateSettingsAction(
  patch: Partial<AppSettingsData>,
): Promise<{ ok: boolean; settings: AppSettingsData }> {
  const settings = await saveSettings(patch);
  revalidateAll();
  return { ok: true, settings };
}

export async function loadDemoDataAction(): Promise<{ ok: boolean; message: string }> {
  const summary = await seedDemoData();
  await saveSettings({ demoMode: true });
  revalidateAll();
  return {
    ok: true,
    message: `Loaded ${summary.props} demo props across ${summary.days} days, settled ${summary.settledPicks} picks, ${summary.teamPicks} team picks, ${summary.bankrollEntries} bankroll entries, ${summary.parlays} parlays.`,
  };
}

export async function clearDemoDataAction(): Promise<{ ok: boolean }> {
  await clearDemoDataPublic();
  revalidateAll();
  return { ok: true };
}

/**
 * Clear picks, slips, bankroll history and the avoid list — after a database
 * backup, and never the research record: props (their market snapshots and
 * grades), logged forecasts and the odds store can't be downloaded again, so
 * they stay. No backup, no delete.
 */
export async function clearAllDataAction(): Promise<{ ok: boolean; message: string }> {
  let backupPath: string;
  try {
    backupPath = backupConfiguredDatabase().backup.path;
  } catch (e) {
    return { ok: false, message: `Nothing deleted: the database backup failed (${e instanceof Error ? e.message : String(e)}).` };
  }
  await prisma.bankrollEntry.deleteMany({});
  await prisma.parlay.deleteMany({});
  await prisma.pick.deleteMany({});
  await prisma.avoidListItem.deleteMany({});
  revalidateAll();
  return { ok: true, message: `Cleared picks, slips, bankroll history and the avoid list. Props, forecasts and odds history kept. Backup: ${backupPath}` };
}

// ---- Avoid list (extra feature) ----

export async function addAvoidItem(input: {
  type: "player" | "propType";
  value: string;
  reason?: string;
}): Promise<{ ok: boolean }> {
  await prisma.avoidListItem.upsert({
    where: { type_value: { type: input.type, value: input.value.trim() } },
    update: { reason: input.reason ?? null },
    create: { type: input.type, value: input.value.trim(), reason: input.reason ?? null },
  });
  revalidatePath("/settings");
  revalidatePath("/analytics");
  return { ok: true };
}

export async function removeAvoidItem(id: string): Promise<{ ok: boolean }> {
  await prisma.avoidListItem.delete({ where: { id } });
  revalidatePath("/settings");
  revalidatePath("/analytics");
  return { ok: true };
}
