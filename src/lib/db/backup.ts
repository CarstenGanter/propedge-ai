import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Timestamped backups of the SQLite database, taken before every migration
 * (npm run db:backup, db:migrate, db:reset). The odds history in it cannot be
 * downloaded again.
 *
 * `VACUUM INTO` writes a consistent snapshot even while a scheduler is writing
 * (the database runs in rollback-journal mode, so a plain file copy can catch
 * a half-written page), and the copy is integrity-checked before it counts.
 */

/** DATABASE_URL ("file:./dev.db") → absolute path. Prisma resolves a relative SQLite path against the schema's folder. */
export function resolveDbPath(databaseUrl: string, schemaDir: string): string {
  if (!databaseUrl.startsWith("file:")) throw new Error(`not a SQLite file URL: ${databaseUrl}`);
  const file = databaseUrl.slice("file:".length).split("?")[0];
  return path.isAbsolute(file) ? file : path.resolve(schemaDir, file);
}

/** dev.db at 2026-10-21T02:03:04Z → dev-20261021-020304Z.db */
export function backupFileName(dbPath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${path.basename(dbPath, path.extname(dbPath))}-${stamp}Z${path.extname(dbPath) || ".db"}`;
}

export interface BackupResult {
  path: string;
  bytes: number;
  /** Row count of every table in the copy. */
  rows: Record<string, number>;
}

export function backupDatabase(dbPath: string, outDir: string, now = new Date()): BackupResult {
  if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, backupFileName(dbPath, now));
  if (existsSync(out)) throw new Error(`backup already exists: ${out}`);

  const src = new DatabaseSync(dbPath, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  const copy = new DatabaseSync(out, { readOnly: true });
  try {
    const check = copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    if (check.integrity_check !== "ok") throw new Error(`backup failed its integrity check: ${check.integrity_check}`);
    const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    const rows: Record<string, number> = {};
    for (const { name } of tables) {
      rows[name] = (copy.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as { n: number }).n;
    }
    return { path: out, bytes: statSync(out).size, rows };
  } finally {
    copy.close();
  }
}

/**
 * Values of environment variables that look like credentials (name contains
 * KEY, SECRET, TOKEN or PASSWORD; value at least 8 characters).
 */
export function secretValues(env: Record<string, string | undefined>): { name: string; value: string }[] {
  return Object.entries(env)
    .filter(([name, value]) => /KEY|SECRET|TOKEN|PASSWORD/i.test(name) && typeof value === "string" && value.length >= 8)
    .map(([name, value]) => ({ name, value: value! }));
}

/** Names of the secrets whose value appears anywhere in the file's bytes. */
export function secretsInFile(file: string, secrets: { name: string; value: string }[]): string[] {
  const bytes = readFileSync(file);
  return secrets.filter((s) => bytes.includes(Buffer.from(s.value))).map((s) => s.name);
}

/**
 * Copy a backup off the machine (DB_BACKUP_COPY_DIR, e.g. an iCloud Drive
 * folder) — but never a file holding a credential: it is re-scanned for every
 * secret-looking value in the environment first.
 */
export function copyOffsite(backup: string, dir: string, env: Record<string, string | undefined>): { copied: string } | { refused: string } {
  const found = secretsInFile(backup, secretValues(env));
  if (found.length) return { refused: `the backup contains the value of ${found.join(", ")}` };
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(backup));
  copyFileSync(backup, dest);
  return { copied: dest };
}
