import type { NewsContext, ScorablePropInput } from "@/types";
import { nameMatches } from "./espn";
import { resolveEspnAthlete } from "./espnPlayerStats";
import { teammateAbsenceBoost } from "@/lib/nfl/injuryReport";
import { getNflGameContextForProp } from "@/lib/nfl/gameContext";
import { teamsMatch } from "@/lib/utils/teamName";

/**
 * NFL player news from free ESPN feeds, never interpreted:
 *  - the official game injury report (status + injury type + date),
 *  - a RotoWire practice/injury note surfaced by ESPN's athlete overview,
 *  - the newest player-relevant headlines (verbatim, with links).
 * Absence from a published report is reported as exactly that — not "healthy".
 */

const OVERVIEW = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes";

interface OverviewJson {
  news?: { headline?: string; published?: string; links?: { web?: { href?: string } } }[];
  rotowire?: { headline?: string; story?: string; published?: string };
}

const overviewCache = new Map<string, { at: number; data: OverviewJson | null }>();
const OVERVIEW_TTL = 30 * 60 * 1000;

async function getOverview(athleteId: string): Promise<OverviewJson | null> {
  const cached = overviewCache.get(athleteId);
  if (cached && Date.now() - cached.at < OVERVIEW_TTL) return cached.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let data: OverviewJson | null = null;
  try {
    const res = await fetch(`${OVERVIEW}/${athleteId}/overview`, { signal: controller.signal, cache: "no-store" });
    if (res.ok) data = (await res.json()) as OverviewJson;
  } catch {
    data = null;
  } finally {
    clearTimeout(timer);
  }
  overviewCache.set(athleteId, { at: Date.now(), data });
  return data;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export async function getNflNews(prop: ScorablePropInput): Promise<NewsContext | undefined> {
  const { context } = await getNflGameContextForProp(prop);
  const ref = await resolveEspnAthlete("NFL", prop.playerName, prop.team, prop.opponent).catch(() => null);

  const notes: NonNullable<NewsContext["notes"]> = [];
  let playerStatus: NewsContext["playerStatus"];
  let teammateAbsencesBoost: boolean | undefined;
  let anySource = false;

  // Team-scoped claims (status, teammate absences) require knowing which side
  // the player is on. Odds-API props always store `team` as the HOME team, so
  // only ESPN's roster resolution is trustworthy here — without it we say nothing.
  if (context && ref) {
    const report = context.injuries.find((t) => teamsMatch(t.team, ref.teamName));
    const entry = report?.players.find((p) => nameMatches(p.name, prop.playerName));
    if (entry) {
      anySource = true;
      playerStatus = entry.status === "active" ? undefined : entry.status;
      notes.push({
        summary: `ESPN game injury report: ${entry.rawStatus || entry.status}${entry.detail ? ` (${entry.detail})` : ""}${
          entry.date ? `, updated ${fmtDate(entry.date)}` : ""
        }.${entry.comment ? ` ${entry.comment}` : ""}`,
        sourceName: "ESPN game injury report",
        sourceUrl: context.sourceUrl,
      });
    } else if (report && report.players.length > 0) {
      // The NFL requires clubs to list every player carrying an injury
      // designation, so absence from a *published* report for this player's own
      // team means no designation — unlike other leagues, that is real
      // information rather than merely missing data.
      anySource = true;
      playerStatus = "active";
      notes.push({
        summary: `No injury designation: not listed on ${ref.teamName}'s published ESPN game injury report (as of ${fmtDate(context.fetchedAt) || "last fetch"}).`,
        sourceName: "ESPN game injury report",
        sourceUrl: context.sourceUrl,
      });
    }
    const boost = teammateAbsenceBoost(prop.propType, prop.playerName, report);
    if (boost.boost) {
      teammateAbsencesBoost = true;
      notes.push({
        summary: `Teammate(s) out at a competing position: ${boost.names.join(", ")}.`,
        sourceName: "ESPN game injury report",
        sourceUrl: context.sourceUrl,
      });
    }
  }

  if (ref) {
    const ov = await getOverview(ref.athleteId);
    const playerUrl = `https://www.espn.com/nfl/player/_/id/${ref.athleteId}`;
    if (ov?.rotowire?.headline) {
      anySource = true;
      const story = (ov.rotowire.story ?? "").trim();
      notes.push({
        summary: `RotoWire: ${ov.rotowire.headline}${story ? ` ${story.slice(0, 280)}${story.length > 280 ? "…" : ""}` : ""}`,
        sourceName: "RotoWire via ESPN",
        sourceUrl: playerUrl,
      });
    }
    const headlines = (ov?.news ?? [])
      .filter((n) => n.headline && n.links?.web?.href)
      .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
      .slice(0, 3);
    for (const n of headlines) {
      anySource = true;
      notes.push({
        summary: `Headline${n.published ? ` (${fmtDate(n.published)})` : ""}: ${n.headline}`,
        sourceName: "ESPN",
        sourceUrl: n.links!.web!.href,
      });
    }
  }

  if (!anySource && teammateAbsencesBoost == null) return undefined;
  return {
    playerStatus,
    teammateAbsencesBoost,
    notes,
    source: "ESPN game injury report + player news",
  };
}
