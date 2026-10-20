import { profileFor } from "./bookProfiles";

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

const same = (a: TimedQuote, b: TimedQuote) => a.line === b.line && a.over === b.over && a.under === b.under;

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
    const moved = after.find((q) => !same(q, before));
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
