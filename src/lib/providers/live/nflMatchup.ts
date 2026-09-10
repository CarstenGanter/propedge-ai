import type { MatchupContext, ScorablePropInput } from "@/types";
import { normalizeTeamName, teamsMatch } from "@/lib/utils/teamName";
import { nflSeasonForDate, statFamilyForProp } from "@/lib/nfl/slate";
import { familyUnit, paceBucket, pickDefenseBasis } from "@/lib/nfl/defense";
import { getDefenseAgg } from "@/lib/nfl/defenseCache";
import { gameEnvironmentFavor } from "@/lib/nfl/gameEnvironment";
import { getNflGameContextForProp } from "@/lib/nfl/gameContext";
import { resolveEspnAthlete } from "./espnPlayerStats";

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
  const [current, priorAgg] = await Promise.all([getDefenseAgg(season), getDefenseAgg(prior)]);
  if (!current && !priorAgg) return undefined;

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
    // No defense data, but the game environment alone is still worth scoring.
    if (!environment) return undefined;
    return {
      environmentFavor: environment.favor,
      environmentNote: environment.note,
      blowoutRisk: environment.blowoutRisk,
      opponentContext: `Opponent defense data unavailable for ${opponentName}.`,
      source: `${context?.odds?.provider ?? "ESPN"} line via ESPN`,
      sourceUrl: context?.sourceUrl,
    };
  }

  const source = basis.basis === "current" ? current! : priorAgg!;
  const pace = paceBucket(basis.agg.playsFacedPg, [...source.values()].map((a) => a.playsFacedPg));
  const unit = familyUnit(family);
  const basisText =
    basis.basis === "current"
      ? `${season} season, ${basis.agg.gp} game${basis.agg.gp === 1 ? "" : "s"}`
      : `${prior} season (${basis.currentGames} of ${season} played — prior-year defense used)`;

  return {
    opponentDefenseRank: basis.rank.rank,
    leagueSize: basis.ranks.size,
    pace,
    environmentFavor: environment?.favor,
    environmentNote: environment?.note,
    blowoutRisk: environment?.blowoutRisk,
    opponentContext:
      `${basis.agg.team} allow ${basis.rank.allowedPg} ${unit}/game (rank ${basis.rank.rank}/${basis.ranks.size}; ` +
      `${basis.agg.playsFacedPg} plays faced/game). Basis: ${basisText}.`,
    source: environment ? "ESPN box scores (aggregated) + posted line" : "ESPN box scores (aggregated)",
    sourceUrl: `https://www.espn.com/nfl/team/stats/_/name/${encodeURIComponent(basis.agg.team.toLowerCase().split(" ").pop() ?? "")}`,
  };
}
