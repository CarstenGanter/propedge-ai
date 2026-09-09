import "server-only";
import { prisma } from "@/lib/db/client";
import { NFL_DEFAULT_MARKETS, PROP_TYPES, SPORTS, type Sport, type ScoringProfile } from "@/types";

export interface AppSettingsData {
  defaultStake: number;
  bankrollStartingAmount: number;
  sportsEnabled: string[];
  minConfidenceThreshold: number;
  maxDailyPicks: number;
  demoMode: boolean;
  enableWebResearch: boolean;
  scoringProfile: ScoringProfile;
  leaguesEnabled: string[];
  minTeamConfidence: number;
  /** NFL prop markets to pull from The Odds API (each = 1 credit per game). */
  nflMarkets: string[];
  /** Max NFL games to pull props for per slate (credit cap). */
  nflMaxGames: number;
  /** Refuse Odds API fetches that would leave fewer credits than this. */
  oddsCreditFloor: number;
}

function parseNflMarkets(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [...NFL_DEFAULT_MARKETS];
    const valid = parsed.filter((m): m is string => typeof m === "string" && PROP_TYPES.NFL.includes(m));
    return valid.length > 0 ? valid : [...NFL_DEFAULT_MARKETS];
  } catch {
    return [...NFL_DEFAULT_MARKETS];
  }
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read the singleton settings row, creating it (seeded from env) on first use. */
export async function getSettings(): Promise<AppSettingsData> {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const row =
    existing ??
    (await prisma.appSettings.create({
      data: {
        id: "singleton",
        defaultStake: envNumber("DEFAULT_STAKE", 5),
        maxDailyPicks: envNumber("MAX_DAILY_PICKS", 10),
        minConfidenceThreshold: envNumber("MIN_CONFIDENCE", 65),
        enableWebResearch:
          process.env.ENABLE_WEB_RESEARCH === "true" || process.env.ENABLE_WEB_RESEARCH === "1",
      },
    }));

  let sportsEnabled: string[];
  try {
    sportsEnabled = JSON.parse(row.sportsEnabledJson);
    if (!Array.isArray(sportsEnabled)) sportsEnabled = [...SPORTS];
  } catch {
    sportsEnabled = [...SPORTS];
  }

  let leaguesEnabled: string[];
  try {
    leaguesEnabled = JSON.parse(row.leaguesEnabledJson);
    if (!Array.isArray(leaguesEnabled)) leaguesEnabled = [];
  } catch {
    leaguesEnabled = [];
  }

  return {
    defaultStake: row.defaultStake,
    bankrollStartingAmount: row.bankrollStartingAmount,
    sportsEnabled,
    minConfidenceThreshold: row.minConfidenceThreshold,
    maxDailyPicks: row.maxDailyPicks,
    demoMode: row.demoMode,
    enableWebResearch: row.enableWebResearch,
    scoringProfile: (row.scoringProfile as ScoringProfile) ?? "balanced",
    leaguesEnabled,
    minTeamConfidence: row.minTeamConfidence,
    nflMarkets: parseNflMarkets(row.nflMarketsJson),
    nflMaxGames: row.nflMaxGames,
    oddsCreditFloor: row.oddsCreditFloor,
  };
}

export async function saveSettings(patch: Partial<AppSettingsData>): Promise<AppSettingsData> {
  await getSettings(); // ensure row exists
  const data: Record<string, unknown> = {};
  if (patch.defaultStake != null) data.defaultStake = patch.defaultStake;
  if (patch.bankrollStartingAmount != null) data.bankrollStartingAmount = patch.bankrollStartingAmount;
  if (patch.sportsEnabled) {
    const valid = patch.sportsEnabled.filter((s): s is Sport =>
      (SPORTS as readonly string[]).includes(s),
    );
    data.sportsEnabledJson = JSON.stringify(valid);
  }
  if (patch.minConfidenceThreshold != null) data.minConfidenceThreshold = patch.minConfidenceThreshold;
  if (patch.maxDailyPicks != null) data.maxDailyPicks = patch.maxDailyPicks;
  if (patch.demoMode != null) data.demoMode = patch.demoMode;
  if (patch.enableWebResearch != null) data.enableWebResearch = patch.enableWebResearch;
  if (patch.scoringProfile) data.scoringProfile = patch.scoringProfile;
  if (patch.leaguesEnabled) data.leaguesEnabledJson = JSON.stringify(patch.leaguesEnabled);
  if (patch.minTeamConfidence != null) data.minTeamConfidence = patch.minTeamConfidence;
  if (patch.nflMarkets) {
    const valid = patch.nflMarkets.filter((m) => PROP_TYPES.NFL.includes(m));
    data.nflMarketsJson = JSON.stringify(valid.length > 0 ? valid : [...NFL_DEFAULT_MARKETS]);
  }
  if (patch.nflMaxGames != null) data.nflMaxGames = Math.max(1, Math.min(20, Math.round(patch.nflMaxGames)));
  if (patch.oddsCreditFloor != null) data.oddsCreditFloor = Math.max(0, Math.round(patch.oddsCreditFloor));

  await prisma.appSettings.update({ where: { id: "singleton" }, data });
  return getSettings();
}
