import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
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

export interface ConfiguredBackup {
  backup: BackupResult;
  /** Where the off-machine copy went, or why it didn't (null: no DB_BACKUP_COPY_DIR set). */
  offsite: { copied: string } | { refused: string } | { failed: string } | null;
  /** Old backups removed by the retention rule, per folder. */
  pruned: { local: string[]; offsite: string[] };
}

/**
 * Back up the database DATABASE_URL points at into prisma/backups (relative
 * to `cwd`, the project root), then copy it off the machine when
 * DB_BACKUP_COPY_DIR is set. Throws if the local backup fails; an off-machine
 * failure is reported, not thrown.
 */
export function backupConfiguredDatabase(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): ConfiguredBackup {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const schemaDir = path.resolve(cwd, "prisma");
  const dbPath = resolveDbPath(url, schemaDir);
  const localDir = path.join(schemaDir, "backups");
  const backup = backupDatabase(dbPath, localDir);
  const base = path.basename(dbPath, path.extname(dbPath));
  const pruned: ConfiguredBackup["pruned"] = { local: pruneBackups(localDir, base), offsite: [] };
  let offsite: ConfiguredBackup["offsite"] = null;
  if (env.DB_BACKUP_COPY_DIR) {
    try {
      offsite = copyOffsite(backup.path, env.DB_BACKUP_COPY_DIR, env);
      // Prune the copy folder only after a successful copy, so it never loses its newest.
      if ("copied" in offsite) pruned.offsite = pruneBackups(env.DB_BACKUP_COPY_DIR, base);
    } catch (e) {
      offsite = { failed: e instanceof Error ? e.message : String(e) };
    }
  }
  return { backup, offsite, pruned };
}

/** Retention (decided 2026-10-21): the newest 10 backups, plus the newest of each of the last 8 weeks. */
export const RETENTION = { recent: 10, weeks: 8 } as const;

const BACKUP_NAME = /^(.+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z\.db$/;

/** When a backup was taken, from its name ("dev-20261021-020304Z.db"); null for any other file. */
export function backupTime(name: string, base?: string): Date | null {
  const m = BACKUP_NAME.exec(name);
  if (!m || (base != null && m[1] !== base)) return null;
  const [y, mo, d, h, mi, s] = m.slice(2).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Which backups the retention rule keeps (pure): the newest RETENTION.recent,
 * plus the newest in each of the last RETENTION.weeks seven-day windows
 * counted back from now. Anything that isn't a backup of this database is
 * never touched.
 */
export function backupsToKeep(names: string[], now: Date, base?: string): Set<string> {
  const backups = names
    .map((name) => ({ name, at: backupTime(name, base) }))
    .filter((b): b is { name: string; at: Date } => b.at != null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const keep = new Set(backups.slice(0, RETENTION.recent).map((b) => b.name));
  const week = 7 * 86_400_000;
  for (let w = 0; w < RETENTION.weeks; w++) {
    const to = now.getTime() - w * week;
    const from = to - week;
    const newest = backups.find((b) => b.at.getTime() <= to && b.at.getTime() > from);
    if (newest) keep.add(newest.name);
  }
  return keep;
}

/** Delete the backups of `base` in `dir` that the retention rule doesn't keep; returns their names. */
export function pruneBackups(dir: string, base: string, now: Date = new Date()): string[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((n) => backupTime(n, base) != null);
  const keep = backupsToKeep(names, now, base);
  const removed = names.filter((n) => !keep.has(n));
  for (const n of removed) unlinkSync(path.join(dir, n));
  return removed;
}
