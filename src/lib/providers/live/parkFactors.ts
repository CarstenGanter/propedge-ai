import { lookupTeam } from "@/lib/utils/teamName";

/**
 * MLB run park factors (1.0 = neutral). >1 favors hitters, <1 favors pitchers.
 * Static constants keyed by normalized home-team name (stadium renames don't
 * matter). Source: Baseball Savant 3-year rolling park factors, snapshot
 * 2026-07 — revisit yearly. The scorer consumes (factor − 1) × 100 clamped ±10.
 */
const PARK_FACTORS: Record<string, number> = {
  "colorado rockies": 1.12,
  "boston red sox": 1.07,
  "cincinnati reds": 1.05,
  "kansas city royals": 1.04,
  "philadelphia phillies": 1.03,
  "washington nationals": 1.03,
  "chicago cubs": 1.02,
  "new york yankees": 1.02,
  "arizona diamondbacks": 1.01,
  "texas rangers": 1.01,
  "atlanta braves": 1.01,
  "baltimore orioles": 1.01,
  "toronto blue jays": 1.0,
  "los angeles angels": 1.0,
  "minnesota twins": 1.0,
  "houston astros": 1.0,
  "pittsburgh pirates": 1.0,
  "st louis cardinals": 0.99,
  "milwaukee brewers": 0.99,
  "chicago white sox": 0.99,
  "los angeles dodgers": 0.98,
  "new york mets": 0.98,
  "tampa bay rays": 0.98,
  "detroit tigers": 0.98,
  "athletics": 0.97,
  "cleveland guardians": 0.97,
  "miami marlins": 0.97,
  "san francisco giants": 0.96,
  "san diego padres": 0.96,
  "seattle mariners": 0.95,
};

const factorMap = new Map<string, number>(Object.entries(PARK_FACTORS));

/** Park factor for a game at the home team's stadium, or undefined if unknown. */
export function getParkFactor(homeTeamName: string): number | undefined {
  return lookupTeam(factorMap, homeTeamName);
}

/** Count of parks (for tests). */
export function parkCount(): number {
  return factorMap.size;
}
