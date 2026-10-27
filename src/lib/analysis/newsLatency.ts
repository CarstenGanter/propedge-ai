import { profileFor } from "./bookProfiles";
import { americanToProb } from "./marketConsensus";

/**
 * How long each venue takes to move a line after news (pure, tested) — the
 * actual test of a news-timing edge. From the moment a player's status changed
 * to Out, for each teammate prop at each book: the last quote fetched before
 * the news, then the first later fetch where the line or price differs.
 *
 * Resolution is our fetch cadence: a move between two fetches is only known to
 * have happened by the second. Where the book reports its own last_update for
 * the market, that time is given too. No move by the last fetch is censored:
 * "at least this long", never counted as a latency.
 */

export interface TimedQuote {
  book: string;
  /** Player and prop, e.g. "Jaxon Smith-Njigba|Receiving Yards". */
  key: string;
  line: number;
  over: number | null;
  under: number | null;
  fetchedAt: Date;
  bookUpdatedAt: Date | null;
}

export interface BookMove {
  book: string;
  group: string;
  key: string;
  /** Minutes from the news to the first fetch showing a move; null when censored. */
  minutes: number | null;
  /** Minutes from the news to the book's own last_update on that move, when it reports one after the news. */
  bookMinutes: number | null;
  /** For a censored row, how long after the news we last looked. */
  observedMinutes: number;
}

/**
 * A price-only change counts as a move when the book's no-vig Over
 * probability shifts by at least this many points. Books re-price in 5-cent
 * ticks: a one-tick re-price (-110/-110 to -115/-105) moves the no-vig Over
 * about 1.1 points, routine rather than a reaction; two ticks (-120/+100)
 * about 2.2; three ticks (-125/+105) about 3.2.
 * Set by judgment, not fitted: there is no history of quote-to-quote changes
 * to fit it on yet; revisit once the trial's +10/+40 pairs give a
 * distribution. A line change always counts.
 */
export const PRICE_MOVE_PTS = 3;

function noVigOver(q: Pick<TimedQuote, "over" | "under">): number | null {
  if (q.over == null || q.under == null) return null;
  const o = americanToProb(q.over);
  const u = americanToProb(q.under);
  return o + u > 0 ? o / (o + u) : null;
}

/** A line change, or a price change of at least PRICE_MOVE_PTS on the no-vig Over (pure). */
export function isMove(before: Pick<TimedQuote, "line" | "over" | "under">, after: Pick<TimedQuote, "line" | "over" | "under">): boolean {
  if (before.line !== after.line) return true;
  const a = noVigOver(before);
  const b = noVigOver(after);
  return a != null && b != null && Math.abs(b - a) * 100 >= PRICE_MOVE_PTS;
}

/**
 * Main-line quotes only: one quote per book, player prop and fetch. A book
 * posting several lines in one fetch (alternates) is left out here — its
 * "move" would be ambiguous.
 */
export function bookMoves(quotes: TimedQuote[], newsAt: Date): BookMove[] {
  const t0 = newsAt.getTime();
  const series = new Map<string, TimedQuote[]>();
  for (const q of quotes) {
    const k = `${q.book}§${q.key}`;
    (series.get(k) ?? series.set(k, []).get(k)!).push(q);
  }
  const out: BookMove[] = [];
  for (const qs of series.values()) {
    const byFetch = new Map<number, TimedQuote[]>();
    for (const q of qs) (byFetch.get(q.fetchedAt.getTime()) ?? byFetch.set(q.fetchedAt.getTime(), []).get(q.fetchedAt.getTime())!).push(q);
    if ([...byFetch.values()].some((f) => f.length > 1)) continue;
    const ordered = [...byFetch.values()].map((f) => f[0]).sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
    const before = ordered.filter((q) => q.fetchedAt.getTime() <= t0).pop();
    const after = ordered.filter((q) => q.fetchedAt.getTime() > t0);
    if (!before || after.length === 0) continue;
    const moved = after.find((q) => isMove(before, q));
    const { book, key } = before;
    const group = profileFor(book).group;
    if (moved) {
      const bt = moved.bookUpdatedAt?.getTime();
      out.push({
        book,
        group,
        key,
        minutes: (moved.fetchedAt.getTime() - t0) / 60_000,
        bookMinutes: bt != null && bt >= t0 ? (bt - t0) / 60_000 : null,
        observedMinutes: (moved.fetchedAt.getTime() - t0) / 60_000,
      });
    } else {
      out.push({ book, group, key, minutes: null, bookMinutes: null, observedMinutes: (after[after.length - 1].fetchedAt.getTime() - t0) / 60_000 });
    }
  }
  return out;
}

export interface GroupLatency {
  group: string;
  /** Teammate props with a quote before and after the news. */
  props: number;
  moved: number;
  /** Median minutes to the first observed move, over the props that moved. */
  medianMinutes: number | null;
  medianBookMinutes: number | null;
  /** Shortest look among the props that had not moved — "at least this long". */
  censoredAtLeast: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per venue group: how many teammate props moved, and how fast. A group's props are counted once per book. */
export function latencyByGroup(moves: BookMove[]): GroupLatency[] {
  const groups = new Map<string, BookMove[]>();
  for (const m of moves) (groups.get(m.group) ?? groups.set(m.group, []).get(m.group)!).push(m);
  return [...groups.entries()]
    .map(([group, ms]) => {
      const moved = ms.filter((m) => m.minutes != null);
      const censored = ms.filter((m) => m.minutes == null);
      return {
        group,
        props: ms.length,
        moved: moved.length,
        medianMinutes: median(moved.map((m) => m.minutes!)),
        medianBookMinutes: median(moved.map((m) => m.bookMinutes).filter((x): x is number => x != null)),
        censoredAtLeast: censored.length ? Math.min(...censored.map((m) => m.observedMinutes)) : null,
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
}

export interface VenueGapAtFetch {
  key: string;
  /** The books' consensus reference line at that fetch, from sportsbooks only. */
  books: number | null;
  underdog: number | null;
  prizepicks: number | null;
}

/**
 * Each venue's line against the books' at one fetch, per teammate prop. A
 * venue far from the books right after the news, closing by the next fetch, is
 * the lag a news edge would live in.
 */
export function venueGapsAtFetch(
  quotes: TimedQuote[],
  consensusLine: (propType: string, quotes: { book: string; line: number; over: number | null; under: number | null }[]) => number | null,
): VenueGapAtFetch[] {
  const byKey = new Map<string, TimedQuote[]>();
  for (const q of quotes) (byKey.get(q.key) ?? byKey.set(q.key, []).get(q.key)!).push(q);
  return [...byKey.entries()].map(([key, qs]) => {
    const propType = key.split("|")[1] ?? "";
    const books = qs.filter((q) => profileFor(q.book).role !== "dfs");
    const venue = (b: string) => qs.find((q) => q.book === b)?.line ?? null;
    return { key, books: books.length ? consensusLine(propType, books) : null, underdog: venue("underdog"), prizepicks: venue("prizepicks") };
  });
}

export interface PropChange {
  book: string;
  group: string;
  key: string;
  moved: boolean;
  /** Second fetch's line minus the first's. */
  lineChange: number;
}

/**
 * How each book's quote of each prop changed between two fetches — the
 * trial's +10 and +40 minute fetches (pure). A book quoting several lines for
 * a prop in either fetch (alternates) is left out.
 */
export function propChangesBetween(first: TimedQuote[], second: TimedQuote[]): PropChange[] {
  const single = (qs: TimedQuote[]) => {
    const by = new Map<string, TimedQuote[]>();
    for (const q of qs) (by.get(`${q.book}§${q.key}`) ?? by.set(`${q.book}§${q.key}`, []).get(`${q.book}§${q.key}`)!).push(q);
    return new Map([...by].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  };
  const a = single(first);
  const b = single(second);
  const out: PropChange[] = [];
  for (const [k, q1] of a) {
    const q2 = b.get(k);
    if (!q2) continue;
    out.push({ book: q1.book, group: profileFor(q1.book).group, key: q1.key, moved: isMove(q1, q2), lineChange: q2.line - q1.line });
  }
  return out;
}

/**
 * Each book's last fetch of each prop at or before `t` — the stored quote the
 * news found in place (pure). Every quote of that fetch is kept, so a book
 * posting alternates there drops out in propChangesBetween as it does there.
 */
export function lastQuotesBefore(quotes: TimedQuote[], t: Date): TimedQuote[] {
  const latest = new Map<string, number>();
  for (const q of quotes) {
    const ft = q.fetchedAt.getTime();
    if (ft > t.getTime()) continue;
    const k = `${q.book}§${q.key}`;
    if (ft > (latest.get(k) ?? -Infinity)) latest.set(k, ft);
  }
  return quotes.filter((q) => latest.get(`${q.book}§${q.key}`) === q.fetchedAt.getTime());
}

export type TeammateGroup = "backup RB" | "pass-catchers (WR/TE)" | "QB" | "other";

/** A teammate of an out running back, by roster position. */
export function teammateGroup(position: string | null | undefined): TeammateGroup {
  const p = (position ?? "").toUpperCase();
  if (p === "RB" || p === "FB") return "backup RB";
  if (p === "WR" || p === "TE") return "pass-catchers (WR/TE)";
  if (p === "QB") return "QB";
  return "other";
}

export interface VenueChange {
  group: string;
  props: number;
  moved: number;
  /** Mean line change across the group's props (moved or not); null with none. */
  meanLineChange: number | null;
}

/** Per venue group: how many props moved between the two fetches, and the mean line change. */
export function summarizeChanges(rows: PropChange[]): VenueChange[] {
  const groups = new Map<string, PropChange[]>();
  for (const r of rows) (groups.get(r.group) ?? groups.set(r.group, []).get(r.group)!).push(r);
  return [...groups.entries()]
    .map(([group, rs]) => ({
      group,
      props: rs.length,
      moved: rs.filter((r) => r.moved).length,
      meanLineChange: rs.length ? rs.reduce((s, r) => s + r.lineChange, 0) / rs.length : null,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}
