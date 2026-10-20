/**
 * Load alternate-ladder responses saved from The Odds API into the odds store
 * as fetchKind "alt". Used once (2026-10-20) for the receiving-yards ladders
 * fetched by hand on 2026-10-17 for the Oct 18 games (13 credits, approved);
 * later ladders arrive with each slate fetch.
 *
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/research/importAltLadders.ts <dir>
 *
 * <dir> holds ev_<eventId>.json bodies and, optionally, h_<eventId>.txt
 * response headers, whose Date header is taken as the fetch time.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db/client";
import { flattenEventQuotes, type OddsEventOdds } from "@/lib/providers/live/theOddsApi";
import { saveQuotes } from "@/lib/oddsStore";

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: importAltLadders.ts <dir>");
  let total = 0;
  for (const f of readdirSync(dir).filter((n) => /^ev_[a-f0-9]+\.json$/.test(n))) {
    const eventId = f.slice(3, -5);
    const event = JSON.parse(readFileSync(join(dir, f), "utf8")) as OddsEventOdds;
    const headers = join(dir, `h_${eventId}.txt`);
    const date = existsSync(headers) ? /^date:\s*(.+)$/im.exec(readFileSync(headers, "utf8"))?.[1] : undefined;
    const fetchedAt = date ? new Date(date.trim()) : statSync(join(dir, f)).mtime;
    const already = await prisma.oddsQuote.count({ where: { eventId, fetchKind: "alt", fetchedAt } });
    if (already > 0) continue;
    total += await saveQuotes(flattenEventQuotes(event, "americanfootball_nfl", eventId), fetchedAt, "alt");
  }
  console.log(`stored ${total} alternate-ladder quotes`);
  await prisma.$disconnect();
}

main();
