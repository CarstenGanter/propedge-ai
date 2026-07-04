import type { MoneylineOdds } from "@/types";
import { LEAGUE_CONFIG, type League } from "@/lib/teamLeagues";
import { americanToProb } from "./theOddsApi";

/**
 * The Odds API — moneyline (h2h) for game-winner picks. Uses the cheap bulk
 * odds endpoint (~1 credit per league), de-vigs each game's prices into fair
 * win probabilities (2-way for US sports, 3-way home/draw/away for soccer).
 */

const BASE = "https://api.the-odds-api.com/v4";

interface FetchResult<T> {
  data: T | null;
  remaining: number | null;
  status: number;
  error?: string;
}

async function fetchJson<T>(url: string, timeoutMs = 9000): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const remaining = Number(res.headers.get("x-requests-remaining"));
    if (!res.ok) {
      return { data: null, remaining: Number.isFinite(remaining) ? remaining : null, status: res.status, error: (await res.text()).slice(0, 200) };
    }
    return { data: (await res.json()) as T, remaining: Number.isFinite(remaining) ? remaining : null, status: res.status };
  } catch (e) {
    return { data: null, remaining: null, status: 0, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

interface OddsGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: { markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
}

export interface MoneylineFetchResult {
  ok: boolean;
  games: MoneylineOdds[];
  creditsRemaining: number | null;
  error?: string;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function maxOrUndef(a: number | undefined, b: number): number {
  return a == null ? b : Math.max(a, b);
}

export async function fetchMoneylines(league: League, apiKey: string): Promise<MoneylineFetchResult> {
  const cfg = LEAGUE_CONFIG[league];
  const url = `${BASE}/sports/${cfg.oddsApiKey}/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${apiKey}`;
  const res = await fetchJson<OddsGame[]>(url);
  if (!res.data) {
    return { ok: false, games: [], creditsRemaining: res.remaining, error: res.error ?? "No games returned" };
  }

  const games: MoneylineOdds[] = [];
  for (const g of res.data) {
    const homeAcc: number[] = [];
    const awayAcc: number[] = [];
    const drawAcc: number[] = [];
    let bestHome: number | undefined;
    let bestAway: number | undefined;
    let bestDraw: number | undefined;
    let books = 0;

    for (const book of g.bookmakers ?? []) {
      const market = book.markets?.find((m) => m.key === "h2h");
      if (!market) continue;
      let hp: number | undefined;
      let ap: number | undefined;
      let dp: number | undefined;
      for (const o of market.outcomes ?? []) {
        if (o.name === g.home_team) hp = o.price;
        else if (o.name === g.away_team) ap = o.price;
        else dp = o.price; // "Draw"
      }
      if (hp == null || ap == null) continue;
      books++;
      const ih = americanToProb(hp);
      const ia = americanToProb(ap);
      const id = dp != null ? americanToProb(dp) : 0;
      const tot = ih + ia + id;
      if (tot <= 0) continue;
      homeAcc.push(ih / tot);
      awayAcc.push(ia / tot);
      if (dp != null) drawAcc.push(id / tot);
      bestHome = maxOrUndef(bestHome, hp);
      bestAway = maxOrUndef(bestAway, ap);
      if (dp != null) bestDraw = maxOrUndef(bestDraw, dp);
    }
    if (books === 0) continue;

    let homeProb = mean(homeAcc);
    let awayProb = mean(awayAcc);
    let drawProb = drawAcc.length ? mean(drawAcc) : 0;
    const s = homeProb + awayProb + drawProb || 1;
    homeProb /= s;
    awayProb /= s;
    drawProb /= s;

    games.push({
      homeTeam: g.home_team,
      awayTeam: g.away_team,
      homePrice: bestHome,
      awayPrice: bestAway,
      drawPrice: bestDraw,
      homeProb: round4(homeProb),
      awayProb: round4(awayProb),
      drawProb: round4(drawProb),
      bookCount: books,
      gameId: g.id,
      commenceTime: g.commence_time,
      source: "The Odds API",
    });
  }

  return { ok: true, games, creditsRemaining: res.remaining };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
