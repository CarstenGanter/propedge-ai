import { lookupTeam, normalizeTeamName } from "@/lib/utils/teamName";

/**
 * Home stadium reference for weather lookups: coordinates, roof type, and the
 * venue's IANA time zone (Open-Meteo returns hourly rows in a named zone).
 * Roof: "dome" = always covered, "retractable" = usually closed in bad weather,
 * "open" = exposed. Verified against 2026 home venues; neutral-site games
 * (London, Germany, Mexico, Brazil) are detected by venue-name mismatch.
 */

export type Roof = "open" | "dome" | "retractable";

export interface Stadium {
  team: string;
  venue: string;
  lat: number;
  lon: number;
  roof: Roof;
  tz: string;
}

export const NFL_STADIUMS: Stadium[] = [
  { team: "Arizona Cardinals", venue: "State Farm Stadium", lat: 33.5276, lon: -112.2626, roof: "retractable", tz: "America/Phoenix" },
  { team: "Atlanta Falcons", venue: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.401, roof: "retractable", tz: "America/New_York" },
  { team: "Baltimore Ravens", venue: "M&T Bank Stadium", lat: 39.278, lon: -76.6227, roof: "open", tz: "America/New_York" },
  { team: "Buffalo Bills", venue: "Highmark Stadium", lat: 42.7738, lon: -78.787, roof: "open", tz: "America/New_York" },
  { team: "Carolina Panthers", venue: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, roof: "open", tz: "America/New_York" },
  { team: "Chicago Bears", venue: "Soldier Field", lat: 41.8623, lon: -87.6167, roof: "open", tz: "America/Chicago" },
  { team: "Cincinnati Bengals", venue: "Paycor Stadium", lat: 39.0954, lon: -84.516, roof: "open", tz: "America/New_York" },
  { team: "Cleveland Browns", venue: "Huntington Bank Field", lat: 41.5061, lon: -81.6995, roof: "open", tz: "America/New_York" },
  { team: "Dallas Cowboys", venue: "AT&T Stadium", lat: 32.7473, lon: -97.0945, roof: "retractable", tz: "America/Chicago" },
  { team: "Denver Broncos", venue: "Empower Field at Mile High", lat: 39.7439, lon: -105.0201, roof: "open", tz: "America/Denver" },
  { team: "Detroit Lions", venue: "Ford Field", lat: 42.34, lon: -83.0456, roof: "dome", tz: "America/New_York" },
  { team: "Green Bay Packers", venue: "Lambeau Field", lat: 44.5013, lon: -88.0622, roof: "open", tz: "America/Chicago" },
  { team: "Houston Texans", venue: "NRG Stadium", lat: 29.6847, lon: -95.4107, roof: "retractable", tz: "America/Chicago" },
  { team: "Indianapolis Colts", venue: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, roof: "retractable", tz: "America/New_York" },
  { team: "Jacksonville Jaguars", venue: "EverBank Stadium", lat: 30.324, lon: -81.6373, roof: "open", tz: "America/New_York" },
  { team: "Kansas City Chiefs", venue: "GEHA Field at Arrowhead Stadium", lat: 39.0489, lon: -94.4839, roof: "open", tz: "America/Chicago" },
  { team: "Las Vegas Raiders", venue: "Allegiant Stadium", lat: 36.0909, lon: -115.1833, roof: "dome", tz: "America/Los_Angeles" },
  { team: "Los Angeles Chargers", venue: "SoFi Stadium", lat: 33.9535, lon: -118.3392, roof: "dome", tz: "America/Los_Angeles" },
  { team: "Los Angeles Rams", venue: "SoFi Stadium", lat: 33.9535, lon: -118.3392, roof: "dome", tz: "America/Los_Angeles" },
  { team: "Miami Dolphins", venue: "Hard Rock Stadium", lat: 25.958, lon: -80.2389, roof: "open", tz: "America/New_York" },
  { team: "Minnesota Vikings", venue: "U.S. Bank Stadium", lat: 44.9736, lon: -93.2575, roof: "dome", tz: "America/Chicago" },
  { team: "New England Patriots", venue: "Gillette Stadium", lat: 42.0909, lon: -71.2643, roof: "open", tz: "America/New_York" },
  { team: "New Orleans Saints", venue: "Caesars Superdome", lat: 29.9511, lon: -90.0812, roof: "dome", tz: "America/Chicago" },
  { team: "New York Giants", venue: "MetLife Stadium", lat: 40.8135, lon: -74.0745, roof: "open", tz: "America/New_York" },
  { team: "New York Jets", venue: "MetLife Stadium", lat: 40.8135, lon: -74.0745, roof: "open", tz: "America/New_York" },
  { team: "Philadelphia Eagles", venue: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, roof: "open", tz: "America/New_York" },
  { team: "Pittsburgh Steelers", venue: "Acrisure Stadium", lat: 40.4468, lon: -80.0158, roof: "open", tz: "America/New_York" },
  { team: "San Francisco 49ers", venue: "Levi's Stadium", lat: 37.403, lon: -121.97, roof: "open", tz: "America/Los_Angeles" },
  { team: "Seattle Seahawks", venue: "Lumen Field", lat: 47.5952, lon: -122.3316, roof: "open", tz: "America/Los_Angeles" },
  { team: "Tampa Bay Buccaneers", venue: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, roof: "open", tz: "America/New_York" },
  { team: "Tennessee Titans", venue: "Nissan Stadium", lat: 36.1665, lon: -86.7713, roof: "open", tz: "America/Chicago" },
  { team: "Washington Commanders", venue: "Northwest Stadium", lat: 38.9076, lon: -76.8645, roof: "open", tz: "America/New_York" },
];

const byTeam = new Map<string, Stadium>(NFL_STADIUMS.map((s) => [normalizeTeamName(s.team), s]));

export function stadiumForTeam(teamName: string): Stadium | undefined {
  return lookupTeam(byTeam, teamName);
}

/**
 * True when the ESPN venue name plausibly refers to the team's home stadium.
 * A mismatch (e.g. "Wembley Stadium", "Allianz Arena") means a neutral site,
 * where the home-stadium coordinates must not be used.
 */
export function venueMatchesStadium(espnVenue: string | null | undefined, stadium: Stadium): boolean {
  if (!espnVenue) return true; // unknown → assume home
  const a = normalizeTeamName(espnVenue);
  const b = normalizeTeamName(stadium.venue);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // Naming rights change often — accept when the distinctive last word matches ("stadium"/"field" excluded).
  const sig = (s: string) => s.split(" ").filter((w) => !["stadium", "field", "at", "the", "of"].includes(w));
  const wa = sig(a);
  const wb = sig(b);
  return wa.some((w) => w.length > 3 && wb.includes(w));
}
