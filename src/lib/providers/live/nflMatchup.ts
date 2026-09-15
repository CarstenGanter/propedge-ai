import type { MatchupContext, ScorablePropInput } from "@/types";
import { normalizeTeamName, teamsMatch } from "@/lib/utils/teamName";
import { nflSeasonForDate, statFamilyForProp } from "@/lib/nfl/slate";
import { familyUnit, paceBucket, pickDefenseBasis } from "@/lib/nfl/defense";
import { getDefenseAgg } from "@/lib/nfl/defenseCache";
import { gameEnvironmentFavor } from "@/lib/nfl/gameEnvironment";
import { getNflGameContextForProp } from "@/lib/nfl/gameContext";
import {
  aggregateDefenseVsPosition,
  metricForProp,
  posGroupOf,
  rankDefenseVsPosition,
} from "@/lib/nfl/defenseByPosition";
import { nflverseCode } from "@/lib/nfl/teamCodes";
import { getIdMap, getWeeklyStats } from "./nflverse";
import { resolveEspnAthlete } from "./espnPlayerStats";

/** Positional splits need a few games before they beat the team-level view. */
const MIN_POSITIONAL_GAMES = 2;

/**
 * Opponent defense against the player's own position group, when we can
 * identify it. A tight end scored against a team's total passing yards allowed
 * is measured against the wrong thing; a defense can smother receivers and be
 * shredded by tight ends.
 */
async function positionalMatchup(
  prop: ScorablePropInput,
  espnAthleteId: string,
  opponentName: string,
  season: number,
  prior: number,
): Promise<{ rank: number; leagueSize: number; context: string } | null> {
  const metric = metricForProp(prop.propType);
  if (!metric) return null;
  const code = nflverseCode(opponentName);
  if (!code) return null;

  const idMap = await getIdMap(season);
  const pos = posGroupOf(idMap.get(espnAthleteId)?.position ?? "");
  if (!pos) return null;

  const rankIn = async (yr: number) => {
    const weekly = await getWeeklyStats(yr);
    if (weekly.length === 0) return null;
    return rankDefenseVsPosition(aggregateDefenseVsPosition(weekly), pos, metric).get(code) ?? null;
  };

  // A single week of positional data is noise, so fall back to last season and
  // say which one the rank came from — the same rule the team-level view uses.
  let hit = await rankIn(season);
  let basisYear = season;
  const currentGames = hit?.gp ?? 0;
  if (!hit || hit.gp < MIN_POSITIONAL_GAMES) {
    const priorHit = await rankIn(prior);
    if (priorHit && priorHit.gp >= MIN_POSITIONAL_GAMES) {
      hit = priorHit;
      basisYear = prior;
    }
  }
  if (!hit || hit.gp < MIN_POSITIONAL_GAMES) return null;

  const unit = metric === "recYdsPg" ? "rec yds" : metric === "rushYdsPg" ? "rush yds" : "receptions";
  const basisText =
    basisYear === season
      ? `${hit.gp} game${hit.gp === 1 ? "" : "s"} of ${season}`
      : `${prior} season (${currentGames} of ${season} played)`;
  return {
    rank: hit.rank,
    leagueSize: hit.leagueSize,
    context:
      `${opponentName} allow ${hit.allowedPg} ${unit}/game to ${pos}s ` +
      `(rank ${hit.rank}/${hit.leagueSize}, basis: ${basisText}).`,
  };
}

/**
 * NFL opponent-defense matchup from aggregated ESPN box scores. Uses the
 * current season once the opponent has ≥3 games, else the prior season — and
 * says so in the context string. `opponentAllowedAverage` is deliberately not
 * set: the engine would compare it to the player's line, which is a different
 * scale (team-allowed vs one player's stat).
 */
export async function getNflMatchup(prop: ScorablePropInput): Promise<MatchupContext | undefined> {
  const family = statFamilyForProp(prop.propType);
  if (!family || !prop.date) return undefined;

  const ref = await resolveEspnAthlete("NFL", prop.playerName, prop.team, prop.opponent).catch(() => null);
  if (!ref) return undefined; // can't tell which side the player is on → don't guess polarity
  const opponentName = ref.teamName === prop.team ? prop.opponent : prop.team;
  const oppKey = normalizeTeamName(opponentName);

  // Game environment: posted total + spread-implied script. ESPN reports the
  // spread from the HOME team's perspective (negative = home favored), so flip
  // it when our player is on the road.
  const { game, context } = await getNflGameContextForProp(prop).catch(() => ({ game: null, context: null }));
  let environment: ReturnType<typeof gameEnvironmentFavor> = null;
  if (context?.odds && game) {
    const isHome = teamsMatch(ref.teamName, game.home.name);
    const homeSpread = context.odds.spread;
    const teamSpread = homeSpread == null ? null : isHome ? homeSpread : -homeSpread;
    environment = gameEnvironmentFavor({
      propType: prop.propType,
      direction: prop.direction,
      gameTotal: context.odds.overUnder,
      teamSpread,
    });
  }

  const { season, prior } = nflSeasonForDate(prop.date);

  // Prefer the position-group view; fall back to team totals below.
  const positional = await positionalMatchup(prop, ref.athleteId, opponentName, season, prior).catch(
    () => null,
  );

  const [current, priorAgg] = await Promise.all([getDefenseAgg(season), getDefenseAgg(prior)]);
  if (!current && !priorAgg && !positional) return undefined;

  // Team names from ESPN box scores are full display names; prop names come
  // from The Odds API (also full names). Fall back to a substring scan.
  const findKey = (agg: Map<string, unknown> | null): string | null => {
    if (!agg) return null;
    if (agg.has(oppKey)) return oppKey;
    for (const k of agg.keys()) if (k.includes(oppKey) || oppKey.includes(k)) return k;
    return null;
  };
  const key = findKey(current) ?? findKey(priorAgg);
  const basis = key ? pickDefenseBasis(current, priorAgg, key, family) : null;
  if (!basis) {
    // No team-total data. A positional rank or the game environment alone is
    // still worth scoring.
    if (!positional && !environment) return undefined;
    return {
      opponentDefenseRank: positional?.rank,
      leagueSize: positional?.leagueSize,
      environmentFavor: environment?.favor,
      environmentNote: environment?.note,
      blowoutRisk: environment?.blowoutRisk,
      opponentContext: positional?.context ?? `Opponent defense data unavailable for ${opponentName}.`,
      source: positional ? "nflverse (defense vs position)" : `${context?.odds?.provider ?? "ESPN"} line via ESPN`,
      sourceUrl: positional ? "https://github.com/nflverse/nflverse-data" : context?.sourceUrl,
    };
  }

  const source = basis.basis === "current" ? current! : priorAgg!;
  const pace = paceBucket(basis.agg.playsFacedPg, [...source.values()].map((a) => a.playsFacedPg));
  const unit = familyUnit(family);
  const basisText =
    basis.basis === "current"
      ? `${season} season, ${basis.agg.gp} game${basis.agg.gp === 1 ? "" : "s"}`
      : `${prior} season (${basis.currentGames} of ${season} played — prior-year defense used)`;

  const teamLevel =
    `${basis.agg.team} allow ${basis.rank.allowedPg} ${unit}/game (rank ${basis.rank.rank}/${basis.ranks.size}; ` +
    `${basis.agg.playsFacedPg} plays faced/game). Basis: ${basisText}.`;

  return {
    // The positional rank is the sharper read when we have it.
    opponentDefenseRank: positional?.rank ?? basis.rank.rank,
    leagueSize: positional?.leagueSize ?? basis.ranks.size,
    pace,
    environmentFavor: environment?.favor,
    environmentNote: environment?.note,
    blowoutRisk: environment?.blowoutRisk,
    opponentContext: positional ? `${positional.context} Team-wide: ${teamLevel}` : teamLevel,
    source: positional
      ? "nflverse (defense vs position) + ESPN box scores"
      : environment
        ? "ESPN box scores (aggregated) + posted line"
        : "ESPN box scores (aggregated)",
    sourceUrl: positional
      ? "https://github.com/nflverse/nflverse-data"
      : `https://www.espn.com/nfl/team/stats/_/name/${encodeURIComponent(basis.agg.team.toLowerCase().split(" ").pop() ?? "")}`,
  };
}
