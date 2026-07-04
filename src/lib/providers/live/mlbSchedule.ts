import { mlbFetch } from "./mlbStats";

/** Shared MLB schedule lookup (teamId → opponent + that team's probable pitcher). */

export interface ScheduleEntry {
  opponentId: number;
  probablePitcherId: number | null;
  probablePitcher: string | null;
}

interface ScheduleResp {
  dates?: {
    games?: {
      teams?: {
        home?: { team?: { id?: number }; probablePitcher?: { id?: number; fullName?: string } };
        away?: { team?: { id?: number }; probablePitcher?: { id?: number; fullName?: string } };
      };
    }[];
  }[];
}

const cache = new Map<string, { at: number; map: Map<number, ScheduleEntry> }>();
const TTL = 30 * 60 * 1000;

export async function getMlbSchedule(date: string): Promise<Map<number, ScheduleEntry>> {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.at < TTL) return cached.map;

  const data = await mlbFetch<ScheduleResp>(
    `/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`,
  );
  const games = data?.dates?.[0]?.games ?? [];
  const map = new Map<number, ScheduleEntry>();
  for (const g of games) {
    const home = g.teams?.home;
    const away = g.teams?.away;
    const hId = home?.team?.id;
    const aId = away?.team?.id;
    if (hId == null || aId == null) continue;
    map.set(hId, {
      opponentId: aId,
      probablePitcherId: home?.probablePitcher?.id ?? null,
      probablePitcher: home?.probablePitcher?.fullName ?? null,
    });
    map.set(aId, {
      opponentId: hId,
      probablePitcherId: away?.probablePitcher?.id ?? null,
      probablePitcher: away?.probablePitcher?.fullName ?? null,
    });
  }
  cache.set(date, { at: Date.now(), map });
  return map;
}
