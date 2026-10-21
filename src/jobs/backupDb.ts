/**
 * Back up the database before a migration:
 *
 *   npm run db:backup        (also run first by db:migrate, db:migrate:deploy and db:reset)
 *
 * Writes prisma/backups/<name>-<UTC timestamp>Z.db and exits non-zero if the
 * backup fails, so the migration after `&&` never runs without one.
 */
import path from "node:path";
import { backupDatabase, resolveDbPath } from "../lib/db/backup";

const SCHEMA_DIR = path.resolve("prisma");

function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = resolveDbPath(url, SCHEMA_DIR);
  const r = backupDatabase(db, path.join(SCHEMA_DIR, "backups"));
  const key = ["OddsQuote", "PlayerProp", "PropPrediction", "Pick", "CreditSpend"].filter((t) => t in r.rows);
  console.log(`db:backup: ${path.relative(process.cwd(), r.path)} (${(r.bytes / 1e6).toFixed(1)} MB, integrity ok; ${key.map((t) => `${t} ${r.rows[t]}`).join(", ")})`);
}

try {
  main();
} catch (e) {
  console.error(`db:backup FAILED — not migrating: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
