/**
 * CLI entry for the daily refresh job. Run headless (e.g. from cron):
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/run-daily.ts
 * or via: npm run daily
 */
import { runDailyRefresh } from "./dailyRefresh";

async function main() {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] PropEdge daily refresh starting…`);
  const summary = await runDailyRefresh();

  if (!summary.ok) {
    console.error(`[${stamp}] Failed: ${summary.error}`);
    process.exit(1);
  }

  for (const s of summary.sports) {
    console.log(`  ${s.sport}: imported ${s.imported} from ${s.events} game(s)${s.error ? ` (${s.error})` : ""}`);
  }
  for (const g of summary.generated) {
    console.log(`  picks ${g.date}: ${g.created} generated from ${g.evaluated} props`);
  }
  console.log(`  settled ${summary.settled} prior pending pick(s) from final games`);
  console.log(`  team picks: generated ${summary.teamsGenerated}, settled ${summary.teamsSettled} prior game(s)`);
  console.log(`[${stamp}] Done. Credits remaining: ${summary.creditsRemaining ?? "unknown"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
