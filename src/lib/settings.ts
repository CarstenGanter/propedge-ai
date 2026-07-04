import "server-only";
import { prisma } from "@/lib/db/client";
import { SPORTS, type Sport, type ScoringProfile } from "@/types";

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

  await prisma.appSettings.update({ where: { id: "singleton" }, data });
  return getSettings();
}
