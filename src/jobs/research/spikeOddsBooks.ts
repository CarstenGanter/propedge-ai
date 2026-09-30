/**
 * One-off spike (about 5 Odds API credits): what does the feed actually return
 * when we ask for specific bookmakers, including Underdog and PrizePicks?
 * Answers the questions the market-consensus and venue-line work depends on,
 * and saves the raw responses for fixtures.
 *
 *   npm run spike:books
 */
import { writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.ODDS_API_KEY!;
const BASE = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";
const OUT = process.env.SPIKE_OUT ?? "spike-out";
const TEN = ["fanduel", "williamhill_us", "draftkings", "betmgm", "espnbet", "fanatics", "betrivers", "betonlineag", "underdog", "prizepicks"];

async function get(path: string, label: string) {
  const res = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${KEY}`);
  const h = (k: string) => res.headers.get(k);
  const body = await res.json().catch(() => null);
  console.log(`\n[${label}] HTTP ${res.status}  cost(last)=${h("x-requests-last")} used=${h("x-requests-used")} remaining=${h("x-requests-remaining")}`);
  writeFileSync(`${OUT}/${label}.json`, JSON.stringify(body, null, 2));
  return body;
}

type Outcome = { name: string; description?: string; price: number; point?: number };
type Market = { key: string; outcomes: Outcome[]; last_update?: string };
type Book = { key: string; markets: Market[]; last_update?: string };

function summarize(ev: { bookmakers?: Book[] } | null) {
  if (!ev?.bookmakers) return console.log("  no bookmakers");
  for (const b of ev.bookmakers) {
    const perMarket = b.markets.map((m) => {
      const players = new Map<string, Set<number>>();
      for (const o of m.outcomes) {
        const set = players.get(o.description ?? "?") ?? new Set();
        if (o.point != null) set.add(o.point);
        players.set(o.description ?? "?", set);
      }
      const multi = [...players.values()].filter((s) => s.size > 1).length;
      const prices = [...new Set(m.outcomes.map((o) => o.price))].slice(0, 6).join(",");
      return `${m.key}: ${players.size} players, ${multi} with >1 line, prices e.g. [${prices}]`;
    });
    console.log(`  ${b.key.padEnd(15)} ${perMarket.join(" | ") || "(no markets)"}`);
  }
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const events = (await get("/events", "events")) as { id: string; commence_time: string; home_team: string; away_team: string }[];
  const next = events.filter((e) => Date.parse(e.commence_time) > Date.now()).sort((a, b) => a.commence_time.localeCompare(b.commence_time))[0];
  console.log(`next event: ${next.away_team} @ ${next.home_team} ${next.commence_time} (${next.id})`);

  const a = await get(`/events/${next.id}/odds?bookmakers=${TEN.join(",")}&markets=player_reception_yds,player_receptions&oddsFormat=american`, "a-ten-bookmakers");
  summarize(a);
  const b = await get(`/events/${next.id}/odds?regions=us,us2&markets=player_reception_yds&oddsFormat=american`, "b-regions-us-us2");
  summarize(b);
  const c = await get(`/events/${next.id}/odds?bookmakers=underdog,prizepicks&markets=player_reception_yds_alternate&oddsFormat=american`, "c-dfs-alternate");
  summarize(c);
})();
