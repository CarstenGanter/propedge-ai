import type { NewsContext } from "@/types";
import { mlbFetch, mlbSeason, resolvePlayerInfo } from "./mlbStats";
import { getMlbSchedule } from "./mlbSchedule";

/**
 * MLB availability signal via the free MLB Stats API: 40-man roster status
 * (injured list / optioned) plus probable-starter confirmation for pitcher
 * strikeout props. Defensive — undefined when the player can't be resolved.
 */

type PlayerStatus = NonNullable<NewsContext["playerStatus"]>;

function mapStatus(desc: string): PlayerStatus | undefined {
  const d = desc.toLowerCase();
  if (d.includes("day to day") || d.includes("day-to-day")) return "questionable";
  if (d.includes("injured") || d.includes(" il") || d.includes("disabled")) return "out";
  if (
    d.includes("minor") ||
    d.includes("option") ||
    d.includes("reassign") ||
    d.includes("designated") ||
    d.includes("restricted") ||
    d.includes("suspend") ||
    d.includes("bereavement") ||
    d.includes("paternity")
  )
    return "out";
  if (d.includes("active")) return "active";
  return undefined;
}

interface RosterResp {
  roster?: { person?: { id?: number }; status?: { description?: string } }[];
}

const statusCache = new Map<number, { at: number; byId: Map<number, string> }>();
const TTL = 30 * 60 * 1000;

async function getTeamStatuses(teamId: number, season: number): Promise<Map<number, string> | null> {
  const cached = statusCache.get(teamId);
  if (cached && Date.now() - cached.at < TTL) return cached.byId;

  const data = await mlbFetch<RosterResp>(
    `/teams/${teamId}/roster?rosterType=40Man&season=${season}`,
  );
  if (!data?.roster) return null;
  const byId = new Map<number, string>();
  for (const e of data.roster) {
    if (e.person?.id != null && e.status?.description) byId.set(e.person.id, e.status.description);
  }
  statusCache.set(teamId, { at: Date.now(), byId });
  return byId;
}

export async function getMlbNews(
  playerName: string,
  propType: string,
  date: string,
): Promise<NewsContext | undefined> {
  const info = await resolvePlayerInfo(playerName);
  if (!info || info.teamId == null) return undefined;

  const season = mlbSeason();
  const statuses = await getTeamStatuses(info.teamId, season);
  const desc = statuses?.get(info.id);
  let playerStatus = desc ? mapStatus(desc) : undefined;

  const notes: NonNullable<NewsContext["notes"]> = [];
  if (desc && playerStatus && playerStatus !== "active") {
    notes.push({ summary: `Roster status: ${desc}.`, sourceName: "MLB Stats API" });
  }

  let lineupConfirmed: boolean | undefined;
  if (propType === "Strikeouts") {
    const entry = (await getMlbSchedule(date)).get(info.teamId);
    if (entry?.probablePitcherId === info.id) {
      lineupConfirmed = true;
      notes.push({ summary: "Confirmed probable starter.", sourceName: "MLB Stats API" });
    } else if (entry?.probablePitcherId != null && entry.probablePitcherId !== info.id) {
      playerStatus = "out";
      notes.push({
        summary: `Not the listed probable starter${entry.probablePitcher ? ` (${entry.probablePitcher} is)` : ""}.`,
        sourceName: "MLB Stats API",
      });
    }
  }

  if (!playerStatus && notes.length === 0) return undefined;

  return {
    playerStatus,
    lineupConfirmed,
    notes,
    source: "MLB Stats API",
  };
}
