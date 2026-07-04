/**
 * CLI entry to capture closing lines for CLV. Best run NEAR game time (not with
 * the morning generate, or closing ≈ entry). Schedule separately, e.g. cron:
 *   node --conditions=react-server --env-file=.env --import tsx src/jobs/run-capture.ts
 * or: npm run capture   (add --props to also capture prop closing lines, uses credits)
 */
import { captureClosingLines } from "@/lib/captureLines";

async function main() {
  const includeProps = process.argv.includes("--props");
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] Capturing closing lines${includeProps ? " (incl. props)" : " (team picks only)"}…`);
  const r = await captureClosingLines({ includeProps });
  if (!r.ok) {
    console.error(`[${stamp}] Failed: ${r.error}`);
    process.exit(1);
  }
  console.log(`  team picks updated: ${r.teamPicksUpdated}`);
  console.log(`  prop picks updated: ${r.propPicksUpdated}`);
  console.log(`[${stamp}] Done. Credits remaining: ${r.creditsRemaining ?? "unknown"}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
