import type { Direction, SettlementStatus, TeamStatus, WagerStatus } from "@/types";

// ---- Input shapes (mapped from Prisma rows by server actions) ----

export interface PickRecord {
  sport: string;
  league: string;
  propType: string;
  direction: Direction;
  confidenceScore: number;
  status: SettlementStatus;
  date: string;
  /** True when you marked this pick as one you actually took. */
  placedReal?: boolean;
  isDemo?: boolean;
  /** Engine that produced `confidenceScore`; only "distribution" is a probability. */
  scoringProfile?: string;
}

/** Which picks an accuracy view covers. */
export type AccuracyScope = "all" | "mine";

export interface AccuracyFilter {
  scope: AccuracyScope;
  /** Sport name, or "All". */
  sport: string;
  /** Exclude demo-seeded picks (they are synthetic and would skew accuracy). */
  includeDemo?: boolean;
}

/** Narrow a record set to one scope/sport (pure, tested). */
export function filterRecords(records: PickRecord[], f: AccuracyFilter): PickRecord[] {
  return records.filter((r) => {
    if (f.scope === "mine" && !r.placedReal) return false;
    if (f.sport !== "All" && r.sport !== f.sport) return false;
    if (!f.includeDemo && r.isDemo) return false;
    return true;
  });
}

export interface BankrollRecord {
  date: string;
  profitLoss: number;
  stake: number;
  payout: number;
  status: WagerStatus;
  entryType?: string;
  sport?: string;
  propType?: string;
}

export interface Record4 {
  total: number;
  settled: number;
  hits: number;
  misses: number;
  pushes: number;
  voids: number;
  pending: number;
  hitRate: number; // percentage 0..100 over decided (hit+miss)
}

export function computeRecord(picks: PickRecord[]): Record4 {
  const r: Record4 = {
    total: picks.length,
    settled: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    voids: 0,
    pending: 0,
    hitRate: 0,
  };
  for (const p of picks) {
    switch (p.status) {
      case "hit":
        r.hits++;
        r.settled++;
        break;
      case "miss":
        r.misses++;
        r.settled++;
        break;
      case "push":
        r.pushes++;
        r.settled++;
        break;
      case "void":
        r.voids++;
        r.settled++;
        break;
      default:
        r.pending++;
    }
  }
  const decided = r.hits + r.misses;
  r.hitRate = decided > 0 ? (r.hits / decided) * 100 : 0;
  return r;
}

// ---- Uncertainty ----
//
// A hit rate quoted without its interval reads as fact whatever it rests on:
// 59.5% off 37 picks and 59.5% off 3,700 look identical on the page and mean
// entirely different things. Every rate shown to a person should carry one.

export interface Interval {
  /** Lower bound, as a percentage 0..100. */
  low: number;
  /** Upper bound, as a percentage 0..100. */
  high: number;
}

/**
 * Wilson score interval for a binomial proportion, as percentages.
 *
 * Preferred over the textbook normal interval because it stays inside [0, 1]
 * and keeps its coverage at the small samples this app actually has — a 5-of-7
 * record breaks the normal approximation outright.
 */
export function wilsonInterval(hits: number, decided: number, z = 1.96): Interval | null {
  if (!Number.isFinite(hits) || !Number.isFinite(decided) || decided <= 0 || hits < 0 || hits > decided) {
    return null;
  }
  const p = hits / decided;
  const z2 = z * z;
  const denom = 1 + z2 / decided;
  const centre = (p + z2 / (2 * decided)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / decided + z2 / (4 * decided * decided));
  return {
    low: Math.max(0, (centre - half) * 100),
    high: Math.min(100, (centre + half) * 100),
  };
}

export interface RateAssessment {
  decided: number;
  /** Percentage 0..100, or null when nothing is decided. */
  hitRate: number | null;
  interval: Interval | null;
  /** The whole interval sits above the break-even bar — a real, evidenced edge. */
  clearsBar: boolean;
  /** The whole interval sits below the bar — evidenced as unprofitable. */
  belowBar: boolean;
  /** The interval excludes 50% — distinguishable from a coin flip. */
  separatesFromChance: boolean;
}

/**
 * Judge a record against the bar it has to clear, rather than against zero.
 *
 * Fixed-multiplier pick'em pays nothing for being good; it pays for being above
 * a specific number. A 59% hit rate is a winning record at 6x and a losing one
 * at 3x, so a bare rate cannot be read without the bar beside it.
 */
export function assessRate(hits: number, misses: number, barPercent: number): RateAssessment {
  const decided = hits + misses;
  const interval = wilsonInterval(hits, decided);
  return {
    decided,
    hitRate: decided > 0 ? (hits / decided) * 100 : null,
    interval,
    clearsBar: interval != null && interval.low > barPercent,
    belowBar: interval != null && interval.high < barPercent,
    separatesFromChance: interval != null && (interval.low > 50 || interval.high < 50),
  };
}

export interface GroupedRecord {
  key: string;
  record: Record4;
}

/**
 * Which groups are actually distinguishable from chance.
 *
 * Reported as a count rather than a leaderboard on purpose. Picking the highest
 * and lowest of ~15 categories at n=5..18 nominates a "best" and a "worst"
 * every single time, whether or not anything separates from a coin flip — and
 * with that many simultaneous comparisons roughly one spurious winner is
 * expected by chance alone.
 */
export function significantGroups(groups: GroupedRecord[], minDecided = 5): {
  separating: GroupedRecord[];
  tested: number;
  /** Closest to separating, for a "nothing yet, but watch this" line. */
  nearest: GroupedRecord | null;
} {
  const tested = groups.filter((g) => g.record.hits + g.record.misses >= minDecided);
  const separating = tested.filter(
    (g) => assessRate(g.record.hits, g.record.misses, 50).separatesFromChance,
  );
  // Nearest = furthest from 50% among those tested; ties broken by sample size.
  const nearest =
    [...tested].sort(
      (a, b) =>
        Math.abs(b.record.hitRate - 50) - Math.abs(a.record.hitRate - 50) ||
        b.record.hits + b.record.misses - (a.record.hits + a.record.misses),
    )[0] ?? null;
  return { separating, tested: tested.length, nearest };
}

/**
 * The sport to show by default: the one being played with real money, falling
 * back to whatever was picked most recently. Averaging a sport you no longer
 * bet into the headline answers a question nobody asked.
 */
export function defaultSport(records: PickRecord[]): string {
  const real = records.filter((r) => r.placedReal && !r.isDemo);
  const pool = real.length > 0 ? real : records.filter((r) => !r.isDemo);
  if (pool.length === 0) return "All";
  const counts = new Map<string, { n: number; latest: string }>();
  for (const r of pool) {
    const cur = counts.get(r.sport) ?? { n: 0, latest: "" };
    counts.set(r.sport, { n: cur.n + 1, latest: r.date > cur.latest ? r.date : cur.latest });
  }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].latest.localeCompare(a[1].latest))[0][0];
}

export function groupRecords(
  picks: PickRecord[],
  keyFn: (p: PickRecord) => string,
): GroupedRecord[] {
  const map = new Map<string, PickRecord[]>();
  for (const p of picks) {
    const k = keyFn(p);
    (map.get(k) ?? map.set(k, []).get(k)!).push(p);
  }
  return [...map.entries()]
    .map(([key, ps]) => ({ key, record: computeRecord(ps) }))
    .sort((a, b) => b.record.total - a.record.total);
}

export function recordBySport(picks: PickRecord[]) {
  return groupRecords(picks, (p) => p.sport);
}
export function recordByLeague(picks: PickRecord[]) {
  return groupRecords(picks, (p) => p.league);
}
export function recordByPropType(picks: PickRecord[]) {
  return groupRecords(picks, (p) => p.propType);
}
export function recordByDirection(picks: PickRecord[]) {
  return groupRecords(picks, (p) => p.direction);
}

// ---- Bankroll / P&L ----

export interface BankrollSummaryData {
  staked: number;
  returned: number;
  profitLoss: number;
  roi: number; // percentage
  startingAmount: number;
  currentBankroll: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number; // percentage over decided wagers
}

export function summarizeBankroll(
  entries: BankrollRecord[],
  startingAmount: number,
): BankrollSummaryData {
  let staked = 0;
  let returned = 0;
  let profitLoss = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;

  for (const e of entries) {
    if (e.status === "pending") {
      pending++;
      continue;
    }
    // Manual adjustments move P/L but are not wagers — exclude from win/loss & staking.
    if (e.entryType === "manual_adjustment") {
      profitLoss += e.profitLoss;
      continue;
    }
    staked += e.stake;
    returned += e.payout;
    profitLoss += e.profitLoss;
    if (e.status === "won") wins++;
    else if (e.status === "lost") losses++;
    else pushes++;
  }
  const decided = wins + losses;
  return {
    staked: round2(staked),
    returned: round2(returned),
    profitLoss: round2(profitLoss),
    roi: staked > 0 ? (profitLoss / staked) * 100 : 0,
    startingAmount,
    currentBankroll: round2(startingAmount + profitLoss),
    wins,
    losses,
    pushes,
    pending,
    winRate: decided > 0 ? (wins / decided) * 100 : 0,
  };
}

export interface PLByGroup {
  key: string;
  profitLoss: number;
  staked: number;
  roi: number;
  count: number;
}

export function profitLossBy(
  entries: BankrollRecord[],
  keyFn: (e: BankrollRecord) => string | undefined,
): PLByGroup[] {
  const map = new Map<string, PLByGroup>();
  for (const e of entries) {
    const k = keyFn(e);
    if (!k) continue;
    const g =
      map.get(k) ?? { key: k, profitLoss: 0, staked: 0, roi: 0, count: 0 };
    g.profitLoss += e.profitLoss;
    g.staked += e.stake;
    g.count += 1;
    map.set(k, g);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      profitLoss: round2(g.profitLoss),
      staked: round2(g.staked),
      roi: g.staked > 0 ? round2((g.profitLoss / g.staked) * 100) : 0,
    }))
    .sort((a, b) => b.profitLoss - a.profitLoss);
}

/** Cumulative P/L over time for the profit/loss chart. */
export function cumulativePLSeries(
  entries: BankrollRecord[],
  startingAmount: number,
): { date: string; bankroll: number; profitLoss: number }[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "pending") continue;
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.profitLoss);
  }
  const dates = [...byDate.keys()].sort();
  let running = 0;
  return dates.map((date) => {
    running += byDate.get(date) ?? 0;
    return {
      date,
      profitLoss: round2(running),
      bankroll: round2(startingAmount + running),
    };
  });
}

export function avgConfidenceWinnersVsLosers(picks: PickRecord[]) {
  const winners = picks.filter((p) => p.status === "hit");
  const losers = picks.filter((p) => p.status === "miss");
  const avg = (xs: PickRecord[]) =>
    xs.length ? xs.reduce((s, p) => s + p.confidenceScore, 0) / xs.length : 0;
  return {
    winners: round1(avg(winners)),
    losers: round1(avg(losers)),
    winnerCount: winners.length,
    loserCount: losers.length,
  };
}

// ---- Team picks (win/loss) ----

export interface TeamRecordInput {
  league: string;
  status: TeamStatus;
}

export interface TeamRecord {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number; // % over decided (win+loss)
}

export function computeTeamRecord(picks: TeamRecordInput[]): TeamRecord {
  const r: TeamRecord = { total: picks.length, settled: 0, wins: 0, losses: 0, pushes: 0, pending: 0, winRate: 0 };
  for (const p of picks) {
    switch (p.status) {
      case "win":
        r.wins++;
        r.settled++;
        break;
      case "loss":
        r.losses++;
        r.settled++;
        break;
      case "push":
      case "void":
        r.pushes++;
        r.settled++;
        break;
      default:
        r.pending++;
    }
  }
  const decided = r.wins + r.losses;
  r.winRate = decided > 0 ? (r.wins / decided) * 100 : 0;
  return r;
}

export function teamRecordByLeague(picks: TeamRecordInput[]): { league: string; record: TeamRecord }[] {
  const map = new Map<string, TeamRecordInput[]>();
  for (const p of picks) (map.get(p.league) ?? map.set(p.league, []).get(p.league)!).push(p);
  return [...map.entries()]
    .map(([league, ps]) => ({ league, record: computeTeamRecord(ps) }))
    .sort((a, b) => b.record.total - a.record.total);
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
function round2(x: number) {
  return Math.round(x * 100) / 100;
}
