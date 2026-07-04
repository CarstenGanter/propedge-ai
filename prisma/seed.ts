/**
 * Seed the local database with clearly-labeled DEMO data.
 * Run with: npm run seed
 *
 * All rows created here are flagged `isDemo` and sourced as "Demo data".
 */
import { seedDemoData } from "../src/lib/demoSeed";

async function main() {
  console.log("Seeding PropEdge AI demo data…");
  const summary = await seedDemoData();
  console.log(
    `Done. ${summary.props} demo props across ${summary.days} days, ` +
      `${summary.settledPicks} settled picks, ${summary.bankrollEntries} bankroll entries, ` +
      `${summary.parlays} parlays.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
