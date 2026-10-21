/**
 * Back up the database before a migration:
 *
 *   npm run db:backup        (also run first by db:migrate, db:migrate:deploy and db:reset)
 *
 * Writes prisma/backups/<name>-<UTC timestamp>Z.db and exits non-zero if the
 * backup fails, so the migration after `&&` never runs without one. With
 * DB_BACKUP_COPY_DIR set (an off-machine folder such as iCloud Drive), the
 * backup is also copied there — unless it contains a credential from the
 * environment. A failed off-machine copy is reported but doesn't block: the
 * local backup already exists.
 */
import path from "node:path";
import { backupConfiguredDatabase } from "../lib/db/backup";

function main() {
  const { backup: r, offsite } = backupConfiguredDatabase();
  const key = ["OddsQuote", "PlayerProp", "PropPrediction", "Pick", "CreditSpend"].filter((t) => t in r.rows);
  console.log(`db:backup: ${path.relative(process.cwd(), r.path)} (${(r.bytes / 1e6).toFixed(1)} MB, integrity ok; ${key.map((t) => `${t} ${r.rows[t]}`).join(", ")})`);
  if (!offsite) return;
  if ("copied" in offsite) console.log(`db:backup: copied off-machine to ${offsite.copied}`);
  else if ("refused" in offsite) console.log(`db:backup: NOT copied off-machine — ${offsite.refused}`);
  else console.error(`db:backup: off-machine copy FAILED (local backup is fine): ${offsite.failed}`);
}

try {
  main();
} catch (e) {
  console.error(`db:backup FAILED — not migrating: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
