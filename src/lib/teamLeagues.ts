// League config for the Team Picks (moneyline / game-winner) vertical.

export const TEAM_LEAGUES = [
  "NFL",
  "MLB",
  "CBB",
  "WNBA",
  "EPL",
  "Bundesliga",
  "UCL",
  "WorldCup",
] as const;
export type League = (typeof TEAM_LEAGUES)[number];

export const LEAGUE_LABELS: Record<League, string> = {
  NFL: "NFL",
  MLB: "MLB",
  CBB: "NCAA Basketball",
  WNBA: "WNBA",
  EPL: "Premier League",
  Bundesliga: "Bundesliga",
  UCL: "Champions League",
  WorldCup: "World Cup",
};

export interface LeagueConfig {
  /** The Odds API sport key. */
  oddsApiKey: string;
  /** ESPN site API path segments. */
  espnSport: string;
  espnLeague: string;
  /** Soccer leagues resolve as home/draw/away (3-way moneyline). */
  threeWay: boolean;
}

export const LEAGUE_CONFIG: Record<League, LeagueConfig> = {
  NFL: { oddsApiKey: "americanfootball_nfl", espnSport: "football", espnLeague: "nfl", threeWay: false },
  MLB: { oddsApiKey: "baseball_mlb", espnSport: "baseball", espnLeague: "mlb", threeWay: false },
  CBB: {
    oddsApiKey: "basketball_ncaab",
    espnSport: "basketball",
    espnLeague: "mens-college-basketball",
    threeWay: false,
  },
  WNBA: { oddsApiKey: "basketball_wnba", espnSport: "basketball", espnLeague: "wnba", threeWay: false },
  EPL: { oddsApiKey: "soccer_epl", espnSport: "soccer", espnLeague: "eng.1", threeWay: true },
  Bundesliga: {
    oddsApiKey: "soccer_germany_bundesliga",
    espnSport: "soccer",
    espnLeague: "ger.1",
    threeWay: true,
  },
  UCL: {
    oddsApiKey: "soccer_uefa_champs_league",
    espnSport: "soccer",
    espnLeague: "uefa.champions",
    threeWay: true,
  },
  WorldCup: { oddsApiKey: "soccer_fifa_world_cup", espnSport: "soccer", espnLeague: "fifa.world", threeWay: true },
};

export function isLeague(v: string): v is League {
  return (TEAM_LEAGUES as readonly string[]).includes(v);
}
