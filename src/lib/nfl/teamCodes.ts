import { lookupTeam, normalizeTeamName } from "@/lib/utils/teamName";

/**
 * Full team name → nflverse team code. nflverse agrees with ESPN on 30 of 32
 * codes; the exceptions are the Rams (`LA` vs ESPN's `LAR`) and the Commanders
 * (`WAS` vs `WSH`), so this table is the single place that difference lives.
 */
const NFLVERSE_CODES: Record<string, string> = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

const byName = new Map<string, string>(
  Object.entries(NFLVERSE_CODES).map(([name, code]) => [normalizeTeamName(name), code]),
);

/** nflverse code for a team named however ESPN or the Odds API spells it. */
export function nflverseCode(teamName: string): string | null {
  return lookupTeam(byName, teamName) ?? null;
}

export const NFLVERSE_TEAM_COUNT = Object.keys(NFLVERSE_CODES).length;
