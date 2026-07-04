"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { generateTeamPicksForDate, type TeamGenerationSummary } from "@/lib/generateTeams";
import { settleTeamPickById } from "@/lib/settleTeams";
import { settleTeamMoneyline } from "@/lib/settlement";
import { getGameResult } from "@/lib/providers/live/espnTeams";
import { isLeague, type League } from "@/lib/teamLeagues";
import { todaySlate } from "@/lib/utils/dates";
import type { TeamSide, TeamStatus } from "@/types";

function revalidateAll() {
  for (const p of ["/", "/teams", "/results", "/analytics"]) revalidatePath(p);
}

export async function generateTeamPicks(date?: string): Promise<TeamGenerationSummary> {
  const summary = await generateTeamPicksForDate(date ?? todaySlate());
  revalidateAll();
  return summary;
}

export interface SettleTeamsSummary {
  date: string;
  settled: number;
  unresolved: number;
  notes: { game: string; note: string }[];
}

/** Auto-settle pending team picks for a date via ESPN final scores. */
export async function settleTeamPicks(date?: string): Promise<SettleTeamsSummary> {
  const slate = date ?? todaySlate();
  const dateCompact = slate.replace(/-/g, "");
  const picks = await prisma.teamPick.findMany({ where: { date: slate, status: "pending" } });

  let settled = 0;
  let unresolved = 0;
  const notes: SettleTeamsSummary["notes"] = [];

  for (const pick of picks) {
    if (!isLeague(pick.league)) {
      unresolved++;
      continue;
    }
    const result = await getGameResult(pick.league as League, dateCompact, pick.homeTeam, pick.awayTeam);
    if (result.resolved && result.winner) {
      await settleTeamPickById(pick.id, { winner: result.winner });
      settled++;
    } else {
      unresolved++;
      notes.push({ game: `${pick.awayTeam} @ ${pick.homeTeam}`, note: result.note ?? "Settle manually." });
    }
  }

  revalidateAll();
  return { date: slate, settled, unresolved, notes };
}

export async function settleTeamPickManually(input: {
  id: string;
  winner?: TeamSide;
  status?: TeamStatus;
  note?: string;
}): Promise<{ ok: boolean; status: string }> {
  const res = await settleTeamPickById(input.id, {
    winner: input.winner,
    status: input.status,
    note: input.note,
  });
  revalidateAll();
  return { ok: true, status: res.status };
}

/** Track a team pick as a moneyline bet (or clear it). */
export async function setTeamBet(input: {
  teamPickId: string;
  mode: "moneyline" | "none";
  stake?: number;
  placedReal?: boolean;
}): Promise<{ ok: boolean }> {
  const pick = await prisma.teamPick.findUnique({ where: { id: input.teamPickId } });
  if (!pick) return { ok: false };

  await prisma.bankrollEntry.deleteMany({
    where: { teamPickId: input.teamPickId, entryType: "moneyline" },
  });
  if (input.mode === "none") {
    revalidateAll();
    return { ok: true };
  }

  const stake = input.stake && input.stake > 0 ? input.stake : 5;
  const status = pick.status as TeamStatus;
  const result = settleTeamMoneyline(stake, pick.priceAmerican, status);

  await prisma.bankrollEntry.create({
    data: {
      date: pick.date,
      teamPickId: pick.id,
      entryType: "moneyline",
      stake,
      payout: status === "pending" ? 0 : result.payout,
      profitLoss: status === "pending" ? 0 : result.profitLoss,
      status: status === "pending" ? "pending" : result.status,
      placedReal: Boolean(input.placedReal),
      isDemo: pick.isDemo,
    },
  });
  revalidateAll();
  return { ok: true };
}

export async function deleteTeamPick(id: string): Promise<{ ok: boolean }> {
  await prisma.bankrollEntry.deleteMany({ where: { teamPickId: id } });
  await prisma.teamPick.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
