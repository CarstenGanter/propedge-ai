import "server-only";
import { prisma } from "@/lib/db/client";
import {
  pickToRecord,
  serializeBankrollEntry,
  serializeParlay,
  serializePick,
  serializeProp,
  serializeTeamParlay,
  serializeTeamPick,
  type SerializedPick,
  type SerializedTeamPick,
} from "@/lib/dto";
import type { BankrollRecord, PickRecord, TeamRecordInput } from "@/lib/analytics";
import type { SettlementStatus, TeamStatus, WagerStatus } from "@/types";

export interface PropModelInput {
  status: SettlementStatus;
  confidenceScore: number;
  entryProb: number | null;
  closingProb: number | null;
  sport: string;
}

export interface TeamModelInput {
  status: TeamStatus;
  winProbability: number;
  marketWinProb: number;
  closingWinProb: number | null;
  league: string;
}

const PICK_INCLUDE = { playerProp: true } as const;

export async function getPicksForDate(date: string): Promise<SerializedPick[]> {
  const picks = await prisma.pick.findMany({
    where: { date },
    include: PICK_INCLUDE,
    orderBy: { rank: "asc" },
  });
  return picks.map(serializePick);
}

/** The most recent slate that actually has generated picks. */
export async function getLatestPickDate(): Promise<string | null> {
  const latest = await prisma.pick.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  return latest?.date ?? null;
}

export async function getPickById(id: string): Promise<SerializedPick | null> {
  const pick = await prisma.pick.findUnique({ where: { id }, include: PICK_INCLUDE });
  return pick ? serializePick(pick) : null;
}

export async function getAllPickRecords(): Promise<PickRecord[]> {
  const picks = await prisma.pick.findMany({ include: PICK_INCLUDE });
  return picks.map(pickToRecord);
}

/** Per-pick inputs for calibration (confidence vs. hit) and CLV (entry vs. closing). */
export async function getPropModelInputs(): Promise<PropModelInput[]> {
  const picks = await prisma.pick.findMany({
    select: { status: true, confidenceScore: true, entryProb: true, closingProb: true, playerProp: { select: { sport: true } } },
  });
  return picks.map((p) => ({
    status: p.status as SettlementStatus,
    confidenceScore: p.confidenceScore,
    entryProb: p.entryProb,
    closingProb: p.closingProb,
    sport: p.playerProp.sport,
  }));
}

export async function getPendingPicks(): Promise<SerializedPick[]> {
  const picks = await prisma.pick.findMany({
    where: { status: "pending" },
    include: PICK_INCLUDE,
    orderBy: [{ date: "desc" }, { rank: "asc" }],
  });
  return picks.map(serializePick);
}

export async function getProps(where?: { date?: string; sport?: string }) {
  const props = await prisma.playerProp.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return props.map(serializeProp);
}

export async function getBankrollEntries() {
  const entries = await prisma.bankrollEntry.findMany({ orderBy: { date: "desc" } });
  return entries.map(serializeBankrollEntry);
}

/** Bankroll rows enriched with sport/propType (via the linked pick) for P/L breakdowns. */
export async function getBankrollRecords(): Promise<BankrollRecord[]> {
  const entries = await prisma.bankrollEntry.findMany({
    include: { pick: { include: { playerProp: true } } },
  });
  return entries.map((e) => ({
    date: e.date,
    profitLoss: e.profitLoss,
    stake: e.stake,
    payout: e.payout,
    status: e.status as WagerStatus,
    entryType: e.entryType,
    sport: e.pick?.playerProp.sport,
    propType: e.pick?.playerProp.propType,
  }));
}

export async function getParlays() {
  const parlays = await prisma.parlay.findMany({
    include: { legs: { include: { pick: { include: { playerProp: true } } } } },
    orderBy: { date: "desc" },
  });
  return parlays.map(serializeParlay);
}

/** Settled + pending picks for a date, for the Results page. */
export async function getResultsForDate(date: string) {
  const picks = await prisma.pick.findMany({
    where: { date },
    include: PICK_INCLUDE,
    orderBy: [{ status: "asc" }, { rank: "asc" }],
  });
  return picks.map(serializePick);
}

export async function getDistinctPickDates(): Promise<string[]> {
  const rows = await prisma.pick.findMany({
    distinct: ["date"],
    select: { date: true },
    orderBy: { date: "desc" },
  });
  return rows.map((r) => r.date);
}

export async function getAvoidList() {
  return prisma.avoidListItem.findMany({ orderBy: { createdAt: "desc" } });
}

// ---- Team picks ----

export async function getTeamPicksForDate(date: string): Promise<SerializedTeamPick[]> {
  const picks = await prisma.teamPick.findMany({ where: { date }, orderBy: { rank: "asc" } });
  return picks.map(serializeTeamPick);
}

export async function getTeamPickById(id: string): Promise<SerializedTeamPick | null> {
  const pick = await prisma.teamPick.findUnique({ where: { id } });
  return pick ? serializeTeamPick(pick) : null;
}

export async function getLatestTeamPickDate(): Promise<string | null> {
  const latest = await prisma.teamPick.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  return latest?.date ?? null;
}

export async function getAllTeamRecords(): Promise<TeamRecordInput[]> {
  const picks = await prisma.teamPick.findMany({ select: { league: true, status: true } });
  return picks.map((p) => ({ league: p.league, status: p.status as TeamStatus }));
}

/** Per-team-pick inputs for calibration (win prob vs. win) and CLV. */
export async function getTeamModelInputs(): Promise<TeamModelInput[]> {
  const picks = await prisma.teamPick.findMany({
    select: { status: true, winProbability: true, marketWinProb: true, closingWinProb: true, league: true },
  });
  return picks.map((p) => ({
    status: p.status as TeamStatus,
    winProbability: p.winProbability,
    marketWinProb: p.marketWinProb,
    closingWinProb: p.closingWinProb,
    league: p.league,
  }));
}

export async function getDistinctTeamPickDates(): Promise<string[]> {
  const rows = await prisma.teamPick.findMany({
    distinct: ["date"],
    select: { date: true },
    orderBy: { date: "desc" },
  });
  return rows.map((r) => r.date);
}

export async function getPicksForParlayBuilder(): Promise<SerializedPick[]> {
  const picks = await prisma.pick.findMany({
    where: { status: "pending" },
    include: PICK_INCLUDE,
    orderBy: [{ date: "desc" }, { confidenceScore: "desc" }],
    take: 60,
  });
  return picks.map(serializePick);
}

// ---- Team parlays (moneyline) ----

export async function getTeamParlays() {
  const parlays = await prisma.teamParlay.findMany({
    include: { legs: { include: { teamPick: true } } },
    orderBy: { date: "desc" },
  });
  return parlays.map(serializeTeamParlay);
}

/** Pending team picks for the moneyline parlay builder (highest confidence first). */
export async function getTeamPicksForParlayBuilder(): Promise<SerializedTeamPick[]> {
  const picks = await prisma.teamPick.findMany({
    where: { status: "pending" },
    orderBy: [{ date: "desc" }, { confidenceScore: "desc" }],
    take: 60,
  });
  return picks.map(serializeTeamPick);
}
