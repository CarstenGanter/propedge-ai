"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { settlePickById } from "@/lib/settle";
import { getSettings } from "@/lib/settings";
import { lookupResult, resolveProviderContext } from "@/lib/providers";
import { propToScorable } from "@/lib/generate";
import { todaySlate } from "@/lib/utils/dates";
import type { SettlementStatus } from "@/types";

function revalidateAll() {
  for (const p of ["/", "/picks", "/results", "/analytics", "/parlays"]) {
    revalidatePath(p);
  }
}

export async function settlePickManually(input: {
  pickId: string;
  actualResult?: number | null;
  status?: SettlementStatus;
  note?: string;
}): Promise<{ ok: boolean; status: string }> {
  const res = await settlePickById(input.pickId, {
    actualResult: input.actualResult,
    status: input.status,
    note: input.note,
  });
  revalidateAll();
  return { ok: true, status: res.status };
}

interface SettleDailySummary {
  date: string;
  settled: number;
  unresolved: number;
  notes: { player: string; note: string }[];
}

/** Attempt to auto-settle all pending picks for a date via the results provider. */
export async function settleDailyPicks(date?: string): Promise<SettleDailySummary> {
  const slate = date ?? todaySlate();
  const settings = await getSettings();

  const picks = await prisma.pick.findMany({
    where: { date: slate, status: "pending" },
    include: { playerProp: true },
  });

  let settled = 0;
  let unresolved = 0;
  const notes: { player: string; note: string }[] = [];

  for (const pick of picks) {
    const ctx = resolveProviderContext({
      propIsDemo: pick.isDemo,
      demoMode: settings.demoMode,
      enableWebResearch: settings.enableWebResearch,
    });
    const lookup = await lookupResult(
      { ...propToScorable(pick.playerProp), date: pick.playerProp.date },
      ctx,
    );
    if (lookup.resolved && lookup.actualResult != null) {
      await settlePickById(pick.id, { actualResult: lookup.actualResult });
      settled++;
    } else {
      unresolved++;
      notes.push({
        player: pick.playerProp.playerName,
        note: lookup.note ?? "Manual settlement required.",
      });
    }
  }

  revalidateAll();
  return { date: slate, settled, unresolved, notes };
}
