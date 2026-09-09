import type { HistoricalSplitsContext, ScorablePropInput } from "@/types";
import { getParkFactor } from "./live/parkFactors";
import { getEspnGameRows, resolveEspnAthlete } from "./live/espnPlayerStats";
import { isPassOrRecProp } from "@/lib/nfl/slate";

/** Rest gaps longer than this are a season opener / bye artifact, not a rest edge. */
const MAX_MEANINGFUL_REST_DAYS = 30;

/**
 * Live historical-splits builder (free sources). Each piece is independently
 * optional; returns undefined only when nothing could be derived. Honest by
 * construction — a piece is omitted rather than guessed.
 *  - MLB: ballpark run factor (home park).
 *  - NBA/WNBA/NFL/NHL/NCAAB: home/away (from the resolved player's team) +
 *    rest days / back-to-back (from the player's recent game dates).
 */

const ESPN_SPORTS = new Set(["NBA", "WNBA", "NCAAB", "NFL", "NHL"]);

/** UTC ISO → US calendar day (shift −6h so late-night-UTC games map to the US day). */
function toGameDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t - 6 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Rest days & back-to-back from a player's game dates vs. the slate date (pure, tested). */
export function restFromDates(
  gameDatesISO: string[],
  propDate: string,
): { restDays: number; backToBack: boolean } | null {
  const days = gameDatesISO
    .map(toGameDay)
    .filter((d) => d && d < propDate)
    .sort();
  if (days.length === 0) return null;
  const restDays = daysBetween(days[days.length - 1], propDate);
  if (restDays < 0) return null;
  return { restDays, backToBack: restDays <= 1 };
}

export async function getLiveHistorical(
  prop: ScorablePropInput,
): Promise<HistoricalSplitsContext | undefined> {
  let homeAway: "home" | "away" | undefined;
  let restDays: number | undefined;
  let backToBack: boolean | undefined;
  let ballparkFactor: number | undefined;
  let weatherConcern: boolean | undefined;
  let weatherNote: string | undefined;
  let sourceUrl: string | undefined;
  let source = "ESPN";

  if (prop.sport === "MLB") {
    // prop.team is the home team for Odds-API props → its park governs the game.
    ballparkFactor = getParkFactor(prop.team);
    source = "MLB park factor constants";
  } else if (ESPN_SPORTS.has(prop.sport)) {
    const ref = await resolveEspnAthlete(prop.sport, prop.playerName, prop.team, prop.opponent).catch(
      () => null,
    );
    // resolveEspnAthlete returns the matched input string; prop.team is the home side.
    if (ref) homeAway = ref.teamName === prop.team ? "home" : "away";
    if (prop.date) {
      const rows = await getEspnGameRows(
        prop.sport,
        prop.playerName,
        prop.team,
        prop.opponent,
        prop.propType,
        prop.date,
      ).catch(() => undefined);
      if (rows && rows.length > 0) {
        const rest = restFromDates(
          rows.map((r) => r.date),
          prop.date,
        );
        if (rest && rest.restDays <= MAX_MEANINGFUL_REST_DAYS) {
          restDays = rest.restDays;
          backToBack = rest.backToBack;
        }
      }
    }
    // NFL: kickoff weather for outdoor venues (Open-Meteo), flagged only for the passing game.
    if (prop.sport === "NFL") {
      // Lazy import: the game-context module is server-only (Prisma-backed cache).
      const { getNflGameContextForProp } = await import("@/lib/nfl/gameContext");
      const { context } = await getNflGameContextForProp(prop).catch(() => ({ context: null }));
      if (context?.assessment) {
        weatherNote = context.assessment.note;
        weatherConcern = context.assessment.concern && isPassOrRecProp(prop.propType) ? true : undefined;
        sourceUrl = context.assessment.sourceUrl ?? context.sourceUrl;
        source = context.assessment.sourceName === "Open-Meteo" ? "ESPN gamelog + Open-Meteo" : "ESPN";
      }
    }
  } else {
    return undefined; // soccer / unknown
  }

  if (
    homeAway === undefined &&
    restDays === undefined &&
    ballparkFactor === undefined &&
    weatherNote === undefined
  ) {
    return undefined;
  }
  return { homeAway, restDays, backToBack, ballparkFactor, weatherConcern, weatherNote, source, sourceUrl };
}
