import "server-only";
import { prisma } from "@/lib/db/client";
import { settleParlay, settleProp, settleSingle } from "@/lib/settlement";
import type { Direction, SettlementStatus } from "@/types";

export interface SettleOptions {
  actualResult?: number | null;
  /** Force a status (e.g. manual push/void) instead of deriving from the result. */
  status?: SettlementStatus;
  note?: string;
}

/** Settle a single pick, cascading to its bankroll entry and any parlay legs. */
export async function settlePickById(pickId: string, opts: SettleOptions) {
  const pick = await prisma.pick.findUnique({
    where: { id: pickId },
    include: { playerProp: true },
  });
  if (!pick) throw new Error("Pick not found");

  const prop = pick.playerProp;
  const status: SettlementStatus =
    opts.status ??
    settleProp(prop.line, prop.direction as Direction, opts.actualResult ?? prop.actualResult);

  const actual =
    opts.actualResult !== undefined ? opts.actualResult : prop.actualResult;

  await prisma.$transaction(async (tx) => {
    await tx.playerProp.update({
      where: { id: prop.id },
      data: { status, actualResult: actual },
    });
    await tx.pick.update({
      where: { id: pick.id },
      data: { status, actualResult: actual, userNote: opts.note ?? pick.userNote },
    });

    // Update any single-bet bankroll entry tied to this pick.
    const entries = await tx.bankrollEntry.findMany({
      where: { pickId: pick.id, entryType: "single" },
    });
    for (const entry of entries) {
      const result = settleSingle(entry.stake, status, prop.payoutMultiplier ?? 2);
      await tx.bankrollEntry.update({
        where: { id: entry.id },
        data: {
          payout: result.payout,
          profitLoss: result.profitLoss,
          status: result.status,
        },
      });
    }

    // Update parlay legs referencing this pick, then re-settle affected parlays.
    const legs = await tx.parlayLeg.findMany({ where: { pickId: pick.id } });
    for (const leg of legs) {
      await tx.parlayLeg.update({ where: { id: leg.id }, data: { status } });
    }
    const parlayIds = [...new Set(legs.map((l) => l.parlayId))];
    for (const parlayId of parlayIds) {
      await recalcParlayTx(tx, parlayId);
    }
  });

  return { status, actualResult: actual };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function recalcParlayTx(tx: Tx, parlayId: string) {
  const parlay = await tx.parlay.findUnique({
    where: { id: parlayId },
    include: { legs: true },
  });
  if (!parlay) return;

  const legStatuses = parlay.legs.map((l) => l.status as SettlementStatus);
  const result = settleParlay(parlay.stake, parlay.payoutMultiplier, legStatuses);

  await tx.parlay.update({
    where: { id: parlayId },
    data: {
      status: result.status,
      actualPayout: result.status === "pending" ? null : result.payout,
      profitLoss: result.status === "pending" ? null : result.profitLoss,
    },
  });

  const entry = await tx.bankrollEntry.findFirst({
    where: { parlayId, entryType: "parlay" },
  });
  if (entry) {
    await tx.bankrollEntry.update({
      where: { id: entry.id },
      data: {
        payout: result.status === "pending" ? 0 : result.payout,
        profitLoss: result.status === "pending" ? 0 : result.profitLoss,
        status: result.status,
      },
    });
  }
}
