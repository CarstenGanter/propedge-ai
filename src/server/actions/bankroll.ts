"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { saveSettings } from "@/lib/settings";
import { settleSingle } from "@/lib/settlement";
import { todaySlate } from "@/lib/utils/dates";
import type { SettlementStatus } from "@/types";

function revalidateAll() {
  for (const p of ["/", "/picks", "/nfl", "/results", "/analytics"]) revalidatePath(p);
}

/**
 * Mark a pick as one you actually took (or un-mark it). Sets `Pick.placedReal`
 * — the flag the analytics "My picks" scope filters on — and mirrors it into a
 * bankroll entry so profit/loss tracks too. Settlement then flows to both.
 */
export async function setPickTaken(input: {
  pickId: string;
  taken: boolean;
  stake?: number;
}): Promise<{ ok: boolean; taken: boolean }> {
  const pick = await prisma.pick.findUnique({ where: { id: input.pickId } });
  if (!pick) return { ok: false, taken: false };

  await prisma.pick.update({
    where: { id: input.pickId },
    data: { placedReal: input.taken },
  });
  await setPickBet({
    pickId: input.pickId,
    mode: input.taken ? "single" : "none",
    stake: input.stake,
    placedReal: input.taken,
  });

  revalidateAll();
  return { ok: true, taken: input.taken };
}

/** Mark a pick as bet as a single (creates/updates its bankroll entry) or not bet. */
export async function setPickBet(input: {
  pickId: string;
  mode: "single" | "none";
  stake?: number;
  placedReal?: boolean;
}): Promise<{ ok: boolean }> {
  const pick = await prisma.pick.findUnique({
    where: { id: input.pickId },
    include: { playerProp: true },
  });
  if (!pick) return { ok: false };

  // Clear any existing single entry for this pick first.
  await prisma.bankrollEntry.deleteMany({
    where: { pickId: input.pickId, entryType: "single" },
  });

  if (input.mode === "none") {
    revalidateAll();
    return { ok: true };
  }

  const stake = input.stake && input.stake > 0 ? input.stake : pick.recommendedStake;
  const settlement = pick.status as SettlementStatus;
  const result = settleSingle(stake, settlement, pick.playerProp.payoutMultiplier ?? 2);

  await prisma.bankrollEntry.create({
    data: {
      date: pick.date,
      pickId: pick.id,
      entryType: "single",
      stake,
      payout: settlement === "pending" ? 0 : result.payout,
      profitLoss: settlement === "pending" ? 0 : result.profitLoss,
      status: settlement === "pending" ? "pending" : result.status,
      placedReal: Boolean(input.placedReal),
      isDemo: pick.isDemo,
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function addManualAdjustment(input: {
  amount: number;
  note?: string;
  date?: string;
}): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.create({
    data: {
      date: input.date ?? todaySlate(),
      entryType: "manual_adjustment",
      stake: 0,
      payout: 0,
      profitLoss: input.amount,
      status: input.amount >= 0 ? "won" : "lost",
      notes: input.note ?? null,
    },
  });
  revalidateAll();
  return { ok: true };
}

export async function updateStartingBankroll(amount: number): Promise<{ ok: boolean }> {
  await saveSettings({ bankrollStartingAmount: amount });
  revalidateAll();
  return { ok: true };
}

export async function deleteBankrollEntry(id: string): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
