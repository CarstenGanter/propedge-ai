import { teamsMatch } from "@/lib/utils/teamName";

/**
 * Which markets a closing-line capture buys for one game (pure, tested): only
 * the prop types of the picks being re-priced in that game, nothing for a game
 * without one. Each market costs one credit per game, so buying the union of
 * the whole slate's prop types for every game paid for markets no pick there
 * needed.
 */
export interface ClosingPick {
  propType: string;
  /** Odds API props store the home side as `team`; either orientation matches. */
  team: string;
  opponent: string;
}

export function marketsForEvent(picks: ClosingPick[], event: { home_team: string; away_team: string }): string[] {
  const inGame = picks.filter(
    (p) =>
      (teamsMatch(event.home_team, p.team) && teamsMatch(event.away_team, p.opponent)) ||
      (teamsMatch(event.home_team, p.opponent) && teamsMatch(event.away_team, p.team)),
  );
  return [...new Set(inGame.map((p) => p.propType))].sort();
}
