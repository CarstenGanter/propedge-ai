// Shared team-name normalization + fuzzy matching for the Team Picks vertical.
// The Odds API, ESPN, and MLB Stats API each spell team names slightly
// differently ("Arizona Diamondbacks" vs "D-backs" vs accents), so we normalize
// to a lowercase, accent-stripped, alphanumeric form and match on substrings.

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeTeamName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when two team names refer to the same team (exact or substring). */
export function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Look up a value in a map keyed by normalized team name, tolerating naming
 * differences (exact key first, then a substring scan).
 */
export function lookupTeam<T>(map: Map<string, T>, name: string): T | undefined {
  const key = normalizeTeamName(name);
  if (!key) return undefined;
  if (map.has(key)) return map.get(key);
  for (const [k, v] of map) {
    if (k && (k === key || k.includes(key) || key.includes(k))) return v;
  }
  return undefined;
}
