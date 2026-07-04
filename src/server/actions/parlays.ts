"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { settleParlay } from "@/lib/settlement";
import { parlayPayout } from "@/lib/analysis/parlayCorrelation";
import { todaySlate } from "@/lib/utils/dates";
import type { SettlementStatus } from "@/types";

function revalidateAll() {
  for (const p of ["/", "/parlays", "/analytics", "/results"]) revalidatePath(p);
}

export async function createParlay(input: {
  name: string;
  stake: number;
  payoutMultiplier: number;
  pickIds: string[];
  placedReal?: boolean;
  date?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (input.pickIds.length < 2) {
    return { ok: false, error: "A parlay needs at least 2 legs." };
  }
  const picks = await prisma.pick.findMany({ where: { id: { in: input.pickIds } } });
  if (picks.length !== input.pickIds.length) {
    return { ok: false, error: "One or more picks could not be found." };
  }

  const stake = input.stake > 0 ? input.stake : 5;
  const multiplier = input.payoutMultiplier > 0 ? input.payoutMultiplier : 1;
  const { projectedPayout } = parlayPayout(stake, multiplier);
  const date = input.date ?? todaySlate();

  const parlay = await prisma.parlay.create({
    data: {
      date,
      name: input.name.trim() || `Parlay ${date}`,
      stake,
      payoutMultiplier: multiplier,
      projectedPayout,
      placedReal: Boolean(input.placedReal),
      isDemo: picks.every((p) => p.isDemo),
      legs: {
        create: picks.map((p) => ({ pickId: p.id, status: p.status })),
      },
    },
    include: { legs: true },
  });

  // Track the parlay stake in the bankroll (pending until settled).
  await prisma.bankrollEntry.create({
    data: {
      date,
      parlayId: parlay.id,
      entryType: "parlay",
      stake,
      payout: 0,
      profitLoss: 0,
      status: "pending",
      placedReal: Boolean(input.placedReal),
      isDemo: parlay.isDemo,
    },
  });

  // If every leg is already decided, settle immediately.
  const legStatuses = parlay.legs.map((l) => l.status as SettlementStatus);
  if (!legStatuses.includes("pending")) {
    const result = settleParlay(stake, multiplier, legStatuses);
    await prisma.parlay.update({
      where: { id: parlay.id },
      data: {
        status: result.status,
        actualPayout: result.payout,
        profitLoss: result.profitLoss,
      },
    });
    await prisma.bankrollEntry.updateMany({
      where: { parlayId: parlay.id, entryType: "parlay" },
      data: { payout: result.payout, profitLoss: result.profitLoss, status: result.status },
    });
  }

  revalidateAll();
  return { ok: true, id: parlay.id };
}

export async function voidParlay(id: string): Promise<{ ok: boolean }> {
  await prisma.parlay.update({
    where: { id },
    data: { status: "void", actualPayout: null, profitLoss: 0 },
  });
  await prisma.bankrollEntry.updateMany({
    where: { parlayId: id, entryType: "parlay" },
    data: { status: "void", payout: 0, profitLoss: 0 },
  });
  revalidateAll();
  return { ok: true };
}

export async function deleteParlayAction(id: string): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.deleteMany({ where: { parlayId: id } });
  await prisma.parlay.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
