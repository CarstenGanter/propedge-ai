import "server-only";
import { prisma } from "@/lib/db/client";
import { settleTeamMoneyline, settleTeamResult } from "@/lib/settlement";
import { settleTeamParlay } from "@/lib/analysis/teamParlay";
import type { TeamSide, TeamStatus } from "@/types";

export interface SettleTeamOptions {
  winner?: TeamSide;
  status?: TeamStatus;
  note?: string;
}

/** Settle a team pick, cascading to its moneyline bankroll entry and parlay legs. */
export async function settleTeamPickById(id: string, opts: SettleTeamOptions) {
  const pick = await prisma.teamPick.findUnique({ where: { id } });
  if (!pick) throw new Error("Team pick not found");

  const winner = opts.winner ?? (pick.actualWinner as TeamSide | null);
  const status: TeamStatus =
    opts.status ?? settleTeamResult(pick.recommendedSide as TeamSide, winner);

  await prisma.$transaction(async (tx) => {
    await tx.teamPick.update({
      where: { id },
      data: {
        status,
        actualWinner: winner ?? pick.actualWinner,
        userNote: opts.note ?? pick.userNote,
      },
    });
    const entries = await tx.bankrollEntry.findMany({
      where: { teamPickId: id, entryType: "moneyline" },
    });
    for (const e of entries) {
      const r = settleTeamMoneyline(e.stake, pick.priceAmerican, status);
      await tx.bankrollEntry.update({
        where: { id: e.id },
        data: { payout: r.payout, profitLoss: r.profitLoss, status: r.status },
      });
    }

    // Cascade to any moneyline parlay legs, then re-settle affected parlays.
    const legs = await tx.teamParlayLeg.findMany({ where: { teamPickId: id } });
    for (const leg of legs) {
      await tx.teamParlayLeg.update({ where: { id: leg.id }, data: { status } });
    }
    const parlayIds = [...new Set(legs.map((l) => l.teamParlayId))];
    for (const parlayId of parlayIds) {
      await recalcTeamParlayTx(tx, parlayId);
    }
  });

  return { status, winner };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function recalcTeamParlayTx(tx: Tx, teamParlayId: string) {
  const parlay = await tx.teamParlay.findUnique({
    where: { id: teamParlayId },
    include: { legs: true },
  });
  if (!parlay) return;

  const result = settleTeamParlay(
    parlay.stake,
    parlay.legs.map((l) => ({ status: l.status as TeamStatus, priceAmerican: l.priceAmerican })),
  );

  await tx.teamParlay.update({
    where: { id: teamParlayId },
    data: {
      status: result.status,
      actualPayout: result.status === "pending" ? null : result.payout,
      profitLoss: result.status === "pending" ? null : result.profitLoss,
    },
  });

  const entry = await tx.bankrollEntry.findFirst({
    where: { teamParlayId, entryType: "team_parlay" },
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
