import "server-only";
import { prisma } from "@/lib/db/client";
import { getSettings } from "@/lib/settings";
import { ingestOddsPropsForSport } from "@/lib/oddsIngest";
import { oddsApiSupportsSport } from "@/lib/providers/live/theOddsApi";
import { generatePicksForDate, propToScorable } from "@/lib/generate";
import { generateTeamPicksForDate } from "@/lib/generateTeams";
import { lookupResult, resolveProviderContext } from "@/lib/providers";
import { settlePickById } from "@/lib/settle";
import { settleTeamPickById } from "@/lib/settleTeams";
import { getGameResult } from "@/lib/providers/live/espnTeams";
import { isLeague, type League } from "@/lib/teamLeagues";
import { hasKey } from "@/lib/providers/config";
import { todaySlate } from "@/lib/utils/dates";
import type { Sport, TeamSide } from "@/types";

export interface DailyRefreshSummary {
  ok: boolean;
  ranAt: string;
  sports: { sport: string; imported: number; events: number; error?: string }[];
  generated: { date: string; created: number; evaluated: number }[];
  settled: number;
  teamsGenerated: number;
  teamsSettled: number;
  creditsRemaining: number | null;
  error?: string;
}

/**
 * Fetch fresh props for every enabled, Odds-API-supported sport, then generate
 * ranked picks for each affected slate. Credit-aware: stops fetching if the
 * remaining balance drops below `creditFloor`. Safe to run headless from cron.
 */
export async function runDailyRefresh(opts?: {
  sports?: Sport[];
  maxEventsPerSport?: number;
  creditFloor?: number;
}): Promise<DailyRefreshSummary> {
  const ranAt = new Date().toISOString();
  const settings = await getSettings();

  if (!hasKey("ODDS_API_KEY")) {
    return { ok: false, ranAt, sports: [], generated: [], settled: 0, teamsGenerated: 0, teamsSettled: 0, creditsRemaining: null, error: "No ODDS_API_KEY set in .env" };
  }

  const enabled = (opts?.sports ?? (settings.sportsEnabled as Sport[])).filter((s) =>
    oddsApiSupportsSport(s),
  );
  const maxEvents = opts?.maxEventsPerSport ?? 8;
  const creditFloor = opts?.creditFloor ?? 25;

  const sportsOut: DailyRefreshSummary["sports"] = [];
  const today = todaySlate();
  const dates = new Set<string>([today]);
  let creditsRemaining: number | null = null;

  for (const sport of enabled) {
    if (creditsRemaining != null && creditsRemaining < creditFloor) {
      sportsOut.push({ sport, imported: 0, events: 0, error: `Skipped — low credits (${creditsRemaining})` });
      continue;
    }
    const r = await ingestOddsPropsForSport(sport, maxEvents);
    if (r.creditsRemaining != null) creditsRemaining = r.creditsRemaining;
    sportsOut.push({ sport, imported: r.imported, events: r.events, error: r.error });
    for (const d of r.dates) dates.add(d);
  }

  const generated: DailyRefreshSummary["generated"] = [];
  for (const date of dates) {
    const summary = await generatePicksForDate(date);
    if (summary.created > 0 || summary.evaluated > 0) {
      generated.push({ date, created: summary.created, evaluated: summary.evaluated });
    }
  }

  // Settle any still-pending picks from prior days (those games are now final).
  const settled = await settlePriorPending(today, settings);

  // Team picks: generate today's board + settle prior pending games.
  const teamGen = await generateTeamPicksForDate(today);
  const teamsSettled = await settlePriorTeams(today);

  return {
    ok: true,
    ranAt,
    sports: sportsOut,
    generated,
    settled,
    teamsGenerated: teamGen.created,
    teamsSettled,
    creditsRemaining: teamGen.creditsRemaining ?? creditsRemaining,
  };
}

async function settlePriorTeams(today: string): Promise<number> {
  const picks = await prisma.teamPick.findMany({
    where: { status: "pending", date: { lt: today } },
  });
  let settled = 0;
  for (const pick of picks) {
    if (!isLeague(pick.league)) continue;
    const result = await getGameResult(
      pick.league as League,
      pick.date.replace(/-/g, ""),
      pick.homeTeam,
      pick.awayTeam,
    );
    if (result.resolved && result.winner) {
      await settleTeamPickById(pick.id, { winner: result.winner as TeamSide });
      settled++;
    }
  }
  return settled;
}

async function settlePriorPending(
  today: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<number> {
  const picks = await prisma.pick.findMany({
    where: { status: "pending", date: { lt: today } },
    include: { playerProp: true },
  });
  let settled = 0;
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
    }
  }
  return settled;
}
