/**
 * Player-name normalisation shared by ingest and closing-line capture. Feeds
 * spell names inconsistently (accents, punctuation, "Jr."), so matching is done
 * on a folded form.
 */
const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");

export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)$/;

/** The folded name without a generational suffix: "Travis Etienne Jr." → "travis etienne". */
export function baseNameOf(s: string): string {
  return normName(s).replace(SUFFIX, "");
}

/**
 * Same name, or same surname and first initial — ignoring a generational
 * suffix, which otherwise becomes the "surname": every "X Jr." with the same
 * first initial matched every other, and "Travis Etienne Jr." missed
 * "Travis Etienne".
 */
export function nameMatch(a: string, b: string): boolean {
  const na = baseNameOf(a);
  const nb = baseNameOf(b);
  if (na === nb) return true;
  const ap = na.split(" ");
  const bp = nb.split(" ");
  return ap[ap.length - 1] === bp[bp.length - 1] && ap[0]?.[0] === bp[0]?.[0];
}

/**
 * The one candidate with this player's name: an exact match (suffix aside)
 * first; a surname-and-initial match only when it is the only one, since two
 * players in a game can share both. Null when none or ambiguous.
 */
export function pickByName<T>(candidates: T[], name: string, nameOf: (c: T) => string): T | null {
  const want = baseNameOf(name);
  const exact = candidates.filter((c) => baseNameOf(nameOf(c)) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const loose = candidates.filter((c) => nameMatch(nameOf(c), name));
  return loose.length === 1 ? loose[0] : null;
}
