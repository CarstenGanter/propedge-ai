"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { teamParlayOdds, settleTeamParlay } from "@/lib/analysis/teamParlay";
import { todaySlate } from "@/lib/utils/dates";
import type { TeamStatus } from "@/types";

function revalidateAll() {
  for (const p of ["/", "/parlays", "/analytics", "/results", "/teams"]) revalidatePath(p);
}

export async function createTeamParlay(input: {
  name: string;
  stake: number;
  teamPickIds: string[];
  placedReal?: boolean;
  date?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (input.teamPickIds.length < 2) {
    return { ok: false, error: "A parlay needs at least 2 legs." };
  }
  const picks = await prisma.teamPick.findMany({ where: { id: { in: input.teamPickIds } } });
  if (picks.length !== input.teamPickIds.length) {
    return { ok: false, error: "One or more team picks could not be found." };
  }

  const stake = input.stake > 0 ? input.stake : 5;
  const { combinedDecimal, combinedAmerican, projectedPayout } = teamParlayOdds(
    picks.map((p) => ({ priceAmerican: p.priceAmerican })),
    stake,
  );
  const date = input.date ?? todaySlate();
  const isDemo = picks.every((p) => p.isDemo);

  const parlay = await prisma.teamParlay.create({
    data: {
      date,
      name: input.name.trim() || `Team parlay ${date}`,
      stake,
      combinedDecimal,
      combinedAmerican,
      projectedPayout,
      placedReal: Boolean(input.placedReal),
      isDemo,
      legs: {
        create: picks.map((p) => ({
          teamPickId: p.id,
          priceAmerican: p.priceAmerican,
          status: p.status,
        })),
      },
    },
    include: { legs: true },
  });

  await prisma.bankrollEntry.create({
    data: {
      date,
      teamParlayId: parlay.id,
      entryType: "team_parlay",
      stake,
      payout: 0,
      profitLoss: 0,
      status: "pending",
      placedReal: Boolean(input.placedReal),
      isDemo,
    },
  });

  // If every leg is already decided, settle immediately.
  const legInputs = parlay.legs.map((l) => ({ status: l.status as TeamStatus, priceAmerican: l.priceAmerican }));
  if (!legInputs.some((l) => l.status === "pending")) {
    const result = settleTeamParlay(stake, legInputs);
    await prisma.teamParlay.update({
      where: { id: parlay.id },
      data: { status: result.status, actualPayout: result.payout, profitLoss: result.profitLoss },
    });
    await prisma.bankrollEntry.updateMany({
      where: { teamParlayId: parlay.id, entryType: "team_parlay" },
      data: { payout: result.payout, profitLoss: result.profitLoss, status: result.status },
    });
  }

  revalidateAll();
  return { ok: true, id: parlay.id };
}

export async function voidTeamParlay(id: string): Promise<{ ok: boolean }> {
  await prisma.teamParlay.update({
    where: { id },
    data: { status: "void", actualPayout: null, profitLoss: 0 },
  });
  await prisma.bankrollEntry.updateMany({
    where: { teamParlayId: id, entryType: "team_parlay" },
    data: { status: "void", payout: 0, profitLoss: 0 },
  });
  revalidateAll();
  return { ok: true };
}

export async function deleteTeamParlayAction(id: string): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.deleteMany({ where: { teamParlayId: id } });
  await prisma.teamParlay.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
