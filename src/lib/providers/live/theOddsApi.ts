import type { Direction, Sport } from "@/types";

/**
 * The Odds API (v4) client for player props.
 *
 * Player props are event-specific markets, so we: (1) list events for a sport,
 * (2) request player-prop markets per event, then (3) de-vig the Over/Under
 * prices into a fair probability per side. Everything is defensive — network or
 * plan errors return empty results rather than throwing.
 *
 * Docs: https://the-odds-api.com/liveapi/guides/v4/
 */

const BASE = "https://api.the-odds-api.com/v4";

/** Our sport → The Odds API sport key. */
const SPORT_KEY: Partial<Record<Sport, string>> = {
  NFL: "americanfootball_nfl",
  NBA: "basketball_nba",
  NCAAB: "basketball_ncaab",
  MLB: "baseball_mlb",
  WNBA: "basketball_wnba",
  NHL: "icehockey_nhl",
  Soccer: "soccer_usa_mls",
};

/**
 * "Soccer" spans multiple competitions, each a separate Odds API sport key. We
 * pull player props from all of them and tag each prop with its competition so
 * World Cup props sit alongside MLS in the Soccer category. World Cup is listed
 * first so it's prioritized while it's in season.
 */
interface Competition {
  sportKey: string;
  label: string;
}
const SOCCER_COMPETITIONS: Competition[] = [
  { sportKey: "soccer_fifa_world_cup", label: "World Cup" },
  { sportKey: "soccer_usa_mls", label: "MLS" },
];

/** All competitions to pull for a sport (soccer → several; others → one). */
function competitionsForSport(sport: Sport): Competition[] {
  if (sport === "Soccer") return SOCCER_COMPETITIONS;
  const key = SPORT_KEY[sport];
  return key ? [{ sportKey: key, label: sport }] : [];
}

/** Our propType → The Odds API market key, per sport family. */
const MARKET_KEYS: Record<string, Record<string, string>> = {
  basketball: {
    Points: "player_points",
    Rebounds: "player_rebounds",
    Assists: "player_assists",
    "Pts+Reb+Ast": "player_points_rebounds_assists",
    "3-Pointers Made": "player_threes",
    "Steals+Blocks": "player_blocks_steals",
  },
  americanfootball: {
    "Passing Yards": "player_pass_yds",
    "Rushing Yards": "player_rush_yds",
    "Receiving Yards": "player_reception_yds",
    Receptions: "player_receptions",
    "Pass TDs": "player_pass_tds",
    Completions: "player_pass_completions",
  },
  baseball: {
    "Total Bases": "batter_total_bases",
    Hits: "batter_hits",
    Strikeouts: "pitcher_strikeouts",
    RBIs: "batter_rbis",
    Runs: "batter_runs_scored",
    "Hits+Runs+RBIs": "batter_hits_runs_rbis",
  },
  icehockey: {
    "Shots on Goal": "player_shots_on_goal",
    Points: "player_points",
    Goals: "player_goals",
    Assists: "player_assists",
    Saves: "player_total_saves",
    "Blocked Shots": "player_blocked_shots",
  },
  soccer: {
    Shots: "player_shots",
    "Shots on Target": "player_shots_on_target",
    "Goals + Assists": "player_goals",
  },
};

function sportFamily(sportKey: string): string {
  return sportKey.split("_")[0];
}

/** propType label for a given Odds API market key (reverse lookup). */
function propTypeForMarket(sportKey: string, marketKey: string): string | null {
  const fam = MARKET_KEYS[sportFamily(sportKey)] ?? {};
  for (const [label, key] of Object.entries(fam)) if (key === marketKey) return label;
  return null;
}

export function oddsApiSupportsSport(sport: string): boolean {
  return sport in SPORT_KEY;
}

// ---- odds math ----

/** American odds → implied probability (includes vig). */
export function americanToProb(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

/** Remove the vig from a two-way market → fair P(over). */
export function noVigProbOver(overPrice: number, underPrice: number): number {
  const o = americanToProb(overPrice);
  const u = americanToProb(underPrice);
  const total = o + u;
  return total > 0 ? o / total : 0.5;
}

// ---- fetch ----

interface FetchResult<T> {
  data: T | null;
  remaining: number | null;
  used: number | null;
  status: number;
  error?: string;
}

async function fetchJson<T>(url: string, timeoutMs = 9000): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const remaining = numHeader(res.headers.get("x-requests-remaining"));
    const used = numHeader(res.headers.get("x-requests-used"));
    if (!res.ok) {
      return { data: null, remaining, used, status: res.status, error: await safeText(res) };
    }
    return { data: (await res.json()) as T, remaining, used, status: res.status };
  } catch (e) {
    return { data: null, remaining: null, used: null, status: 0, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function numHeader(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return `HTTP ${res.status}`;
  }
}

interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface OddsOutcome {
  name: string; // "Over" | "Under"
  description?: string; // player name
  price: number;
  point?: number;
}
interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}
interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}
interface OddsEventOdds {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: OddsBookmaker[];
}

export interface OddsApiStatus {
  ok: boolean;
  remaining: number | null;
  used: number | null;
  error?: string;
}

export async function listSports(apiKey: string): Promise<{ status: OddsApiStatus; sports: { key: string; title: string }[] }> {
  const r = await fetchJson<{ key: string; title: string; active: boolean }[]>(
    `${BASE}/sports/?apiKey=${apiKey}`,
  );
  return {
    status: { ok: r.status === 200, remaining: r.remaining, used: r.used, error: r.error },
    sports: (r.data ?? []).filter((s) => s.active).map((s) => ({ key: s.key, title: s.title })),
  };
}

async function getEvents(apiKey: string, sportKey: string): Promise<OddsEvent[]> {
  const r = await fetchJson<OddsEvent[]>(`${BASE}/sports/${sportKey}/events/?apiKey=${apiKey}`);
  return r.data ?? [];
}

async function getEventProps(
  apiKey: string,
  sportKey: string,
  eventId: string,
  markets: string[],
  regions = "us",
): Promise<FetchResult<OddsEventOdds>> {
  const url =
    `${BASE}/sports/${sportKey}/events/${eventId}/odds/?apiKey=${apiKey}` +
    `&regions=${regions}&markets=${markets.join(",")}&oddsFormat=american`;
  return fetchJson<OddsEventOdds>(url);
}

// ---- normalization ----

export interface NormalizedProp {
  playerName: string;
  propType: string;
  direction: Direction; // the market's favored (no-vig) side
  line: number; // consensus line
  projection: number; // market-implied projection nudged toward the lean
  noVigProbOver: number; // 0..1
  bookCount: number;
  comparableLines: number[];
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  /** Competition label (e.g. "World Cup", "MLS") — usually the sport, but soccer spans several. */
  league: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Collapse all books' Over/Under outcomes into one normalized prop per player+market. */
function normalizeEvent(event: OddsEventOdds, sportKey: string, league: string): NormalizedProp[] {
  // key: `${player}||${propType}` -> aggregation
  const agg = new Map<
    string,
    { player: string; propType: string; lines: number[]; novig: number[] }
  >();

  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const propType = propTypeForMarket(sportKey, market.key);
      if (!propType) continue;
      // group this book's outcomes by player
      const byPlayer = new Map<string, { over?: OddsOutcome; under?: OddsOutcome }>();
      for (const o of market.outcomes ?? []) {
        if (!o.description) continue;
        const slot = byPlayer.get(o.description) ?? {};
        if (o.name.toLowerCase() === "over") slot.over = o;
        else if (o.name.toLowerCase() === "under") slot.under = o;
        byPlayer.set(o.description, slot);
      }
      for (const [player, { over, under }] of byPlayer) {
        if (over?.point == null) continue;
        const k = `${player}||${propType}`;
        const a = agg.get(k) ?? { player, propType, lines: [], novig: [] };
        a.lines.push(over.point);
        if (over.price != null && under?.price != null) {
          a.novig.push(noVigProbOver(over.price, under.price));
        }
        agg.set(k, a);
      }
    }
  }

  const out: NormalizedProp[] = [];
  for (const a of agg.values()) {
    if (a.lines.length === 0) continue;
    const line = median(a.lines);
    const pOver = a.novig.length ? a.novig.reduce((s, x) => s + x, 0) / a.novig.length : 0.5;
    const direction: Direction = pOver >= 0.5 ? "OVER" : "UNDER";
    const leanStrength = Math.abs(pOver - 0.5); // 0..0.5
    const offset = leanStrength * Math.max(1, line) * 0.5; // market-implied nudge
    const projection = direction === "OVER" ? line + offset : line - offset;
    out.push({
      playerName: a.player,
      propType: a.propType,
      direction,
      line,
      projection: Math.round(projection * 10) / 10,
      noVigProbOver: Math.round(pOver * 1000) / 1000,
      bookCount: a.novig.length || a.lines.length,
      comparableLines: [...new Set(a.lines)],
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      commenceTime: event.commence_time,
      league,
    });
  }
  return out;
}

export interface FetchPropsResult {
  status: OddsApiStatus;
  props: NormalizedProp[];
  events: number;
  sportKey: string;
}

/**
 * Fetch & normalize player props for a sport. Caps the number of events to
 * protect API credits (each event is a separate, markets×regions-priced call).
 * Soccer spans several competitions (World Cup, MLS, …); the event cap is split
 * across them so a full slate can't blow the credit budget, and each prop is
 * tagged with its competition.
 */
export async function fetchPlayerProps(
  apiKey: string,
  sport: Sport,
  maxEvents = 12,
): Promise<FetchPropsResult> {
  const comps = competitionsForSport(sport);
  if (comps.length === 0) {
    return { status: { ok: false, remaining: null, used: null, error: "Unsupported sport" }, props: [], events: 0, sportKey: "" };
  }
  const perComp = Math.max(1, Math.floor(maxEvents / comps.length));

  const all: NormalizedProp[] = [];
  let remaining: number | null = null;
  let used: number | null = null;
  let lastError: string | undefined;
  let totalEvents = 0;

  for (const comp of comps) {
    const fam = MARKET_KEYS[sportFamily(comp.sportKey)] ?? {};
    const marketKeys = Object.values(fam);
    if (marketKeys.length === 0) continue;

    const events = await getEvents(apiKey, comp.sportKey);
    const upcoming = events
      .filter((e) => new Date(e.commence_time).getTime() > Date.now() - 3 * 3600_000)
      .slice(0, perComp);
    totalEvents += upcoming.length;

    for (const ev of upcoming) {
      const r = await getEventProps(apiKey, comp.sportKey, ev.id, marketKeys);
      if (r.remaining != null) remaining = r.remaining;
      if (r.used != null) used = r.used;
      if (r.error) lastError = r.error;
      if (r.data) all.push(...normalizeEvent(r.data, comp.sportKey, comp.label));
    }
  }

  return {
    status: { ok: all.length > 0 || !lastError, remaining, used, error: all.length === 0 ? lastError : undefined },
    props: all,
    events: totalEvents,
    sportKey: comps[0].sportKey,
  };
}
