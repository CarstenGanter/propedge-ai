import { normName } from "@/lib/utils/playerName";

/**
 * How a fresh Odds API fetch is merged into the props already stored for a
 * slate (pure, tested).
 *
 * Ingest used to delete every pending prop for the slate and recreate it. Picks
 * cascade from props and slip legs cascade from picks, so a second Fetch on the
 * same day silently wiped the Underdog lines and payouts typed in, "not
 * offered" marks, captured closing lines, and the legs of saved slips. Now a
 * prop is updated in place, matched on what identifies it.
 */

export interface PropIdentity {
  date: string;
  playerName: string;
  propType: string;
  gameId: string | null;
  team: string;
  opponent: string;
}

export function propKey(p: PropIdentity): string {
  const game = p.gameId ?? `${normName(p.team)}~${normName(p.opponent)}`;
  return `${p.date}|${normName(p.playerName)}|${p.propType}|${game}`;
}

export interface StoredProp {
  id: string;
  key: string;
  /** Has at least one pick — something the user may have acted on. */
  hasPick: boolean;
}

export interface IngestPlan {
  /** Incoming key → id of the stored prop to update in place. */
  update: Map<string, { id: string; hasPick: boolean }>;
  /** Incoming keys with no stored prop. */
  create: string[];
  /** Stored props the fetch no longer offers and nothing depends on. */
  remove: string[];
}

export function planIngest(stored: StoredProp[], incomingKeys: string[]): IngestPlan {
  const incoming = new Set(incomingKeys);
  const byKey = new Map<string, StoredProp[]>();
  for (const s of stored) (byKey.get(s.key) ?? byKey.set(s.key, []).get(s.key)!).push(s);

  const update = new Map<string, { id: string; hasPick: boolean }>();
  const remove: string[] = [];
  for (const [key, rows] of byKey) {
    // Prefer the row with a pick, so a duplicate never outranks real history.
    const [keep, ...extra] = [...rows].sort((a, b) => Number(b.hasPick) - Number(a.hasPick));
    for (const e of extra) if (!e.hasPick) remove.push(e.id);
    if (incoming.has(key)) update.set(key, { id: keep.id, hasPick: keep.hasPick });
    else if (!keep.hasPick) remove.push(keep.id);
  }
  const create = [...incoming].filter((k) => !update.has(k));
  return { update, create, remove };
}

/**
 * Which stored fields a refresh may change. A prop with a pick keeps its line
 * and side — the pick was made, and may have been played, on those — and only
 * its market snapshot moves. A prop nobody has picked is refreshed entirely.
 */
export function refreshableFields<T extends { line: number; direction: string }>(
  incoming: T,
  hasPick: boolean,
): Partial<T> {
  if (!hasPick) return incoming;
  const { line: _line, direction: _direction, ...rest } = incoming;
  void _line;
  void _direction;
  return rest as Partial<T>;
}
