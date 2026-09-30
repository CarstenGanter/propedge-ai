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

/** Same full name, or same surname and first initial. */
export function nameMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (na === nb) return true;
  const ap = na.split(" ");
  const bp = nb.split(" ");
  return ap[ap.length - 1] === bp[bp.length - 1] && ap[0]?.[0] === bp[0]?.[0];
}
