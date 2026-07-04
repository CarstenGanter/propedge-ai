"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { saveSettings, type AppSettingsData } from "@/lib/settings";
import { seedDemoData, clearDemoDataPublic } from "@/lib/demoSeed";

function revalidateAll() {
  for (const p of ["/", "/picks", "/research", "/results", "/analytics", "/parlays", "/settings"]) {
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

export async function clearAllDataAction(): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.deleteMany({});
  await prisma.parlay.deleteMany({});
  await prisma.pick.deleteMany({});
  await prisma.playerProp.deleteMany({});
  await prisma.avoidListItem.deleteMany({});
  revalidateAll();
  return { ok: true };
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
