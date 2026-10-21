import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupConfiguredDatabase, backupDatabase, backupFileName, backupsToKeep, backupTime, copyOffsite, pruneBackups, resolveDbPath, secretValues } from "./backup";

describe("resolveDbPath", () => {
  it("resolves a relative SQLite URL against the schema folder, as Prisma does", () => {
    expect(resolveDbPath("file:./dev.db", "/repo/prisma")).toBe("/repo/prisma/dev.db");
    expect(resolveDbPath("file:/data/x.db?connection_limit=1", "/repo/prisma")).toBe("/data/x.db");
    expect(() => resolveDbPath("postgresql://h/db", "/repo/prisma")).toThrow();
  });
});

describe("backupFileName", () => {
  it("stamps the name with the UTC time, sortable", () => {
    expect(backupFileName("/repo/prisma/dev.db", new Date("2026-10-21T02:03:04.567Z"))).toBe("dev-20261021-020304Z.db");
  });
});

describe("backupDatabase", () => {
  const fixture = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dbbackup-"));
    const db = path.join(dir, "dev.db");
    const d = new DatabaseSync(db);
    d.exec(`CREATE TABLE "OddsQuote" (id TEXT PRIMARY KEY, line REAL); CREATE TABLE "PlayerProp" (id TEXT PRIMARY KEY)`);
    const ins = d.prepare(`INSERT INTO "OddsQuote" VALUES (?, ?)`);
    for (let i = 0; i < 25; i++) ins.run(`q${i}`, 40.5 + i);
    d.exec(`INSERT INTO "PlayerProp" VALUES ('p1')`);
    d.close();
    return { dir, db };
  };

  it("writes a consistent, integrity-checked copy with every row", () => {
    const { dir, db } = fixture();
    const r = backupDatabase(db, path.join(dir, "backups"), new Date("2026-10-21T02:03:04Z"));
    expect(r.path).toBe(path.join(dir, "backups", "dev-20261021-020304Z.db"));
    expect(r.rows).toEqual({ OddsQuote: 25, PlayerProp: 1 });
    const copy = new DatabaseSync(r.path, { readOnly: true });
    expect((copy.prepare(`SELECT line FROM "OddsQuote" WHERE id = 'q24'`).get() as { line: number }).line).toBe(64.5);
    copy.close();
  });

  it("refuses to overwrite an existing backup, and fails loudly with no database", () => {
    const { dir, db } = fixture();
    const now = new Date("2026-10-21T02:03:04Z");
    backupDatabase(db, path.join(dir, "backups"), now);
    expect(() => backupDatabase(db, path.join(dir, "backups"), now)).toThrow(/already exists/);
    expect(() => backupDatabase(path.join(dir, "missing.db"), path.join(dir, "backups"))).toThrow(/no database/);
  });

  it("fails rather than call a corrupt file a backup", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dbbackup-"));
    const bad = path.join(dir, "bad.db");
    writeFileSync(bad, "not a database");
    expect(() => backupDatabase(bad, path.join(dir, "backups"))).toThrow();
  });
});

describe("copyOffsite", () => {
  it("copies a clean backup off the machine", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "offsite-"));
    const file = path.join(dir, "dev-20261021-020304Z.db");
    writeFileSync(file, "odds history, no credentials");
    const r = copyOffsite(file, path.join(dir, "icloud"), { ODDS_API_KEY: "abcdef1234567890" });
    expect(r).toEqual({ copied: path.join(dir, "icloud", "dev-20261021-020304Z.db") });
    expect(existsSync(path.join(dir, "icloud", "dev-20261021-020304Z.db"))).toBe(true);
  });

  it("refuses a backup that contains a credential's value", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "offsite-"));
    const file = path.join(dir, "dev.db");
    writeFileSync(file, "...url ?apiKey=abcdef1234567890&markets=...");
    const r = copyOffsite(file, path.join(dir, "icloud"), { ODDS_API_KEY: "abcdef1234567890" });
    expect(r).toEqual({ refused: "the backup contains the value of ODDS_API_KEY" });
    expect(existsSync(path.join(dir, "icloud"))).toBe(false);
  });

  it("only treats credential-looking variables as secrets", () => {
    expect(secretValues({ ODDS_API_KEY: "abcdef1234567890", NEWS_API_KEY: "", DATABASE_URL: "file:./dev.db", MAX_DAILY_PICKS: "10" }).map((s) => s.name)).toEqual(["ODDS_API_KEY"]);
  });
});

describe("backupConfiguredDatabase", () => {
  it("backs up the database DATABASE_URL names into prisma/backups, and copies it off-machine when configured", () => {
    const root = mkdtempSync(path.join(tmpdir(), "project-"));
    mkdirSync(path.join(root, "prisma"));
    const d = new DatabaseSync(path.join(root, "prisma", "dev.db"));
    d.exec(`CREATE TABLE "OddsQuote" (id TEXT); INSERT INTO "OddsQuote" VALUES ('q1')`);
    d.close();
    const r = backupConfiguredDatabase({ DATABASE_URL: "file:./dev.db", DB_BACKUP_COPY_DIR: path.join(root, "icloud") }, root);
    expect(path.dirname(r.backup.path)).toBe(path.join(root, "prisma", "backups"));
    expect(r.backup.rows).toEqual({ OddsQuote: 1 });
    expect(r.offsite).toEqual({ copied: path.join(root, "icloud", path.basename(r.backup.path)) });
  });

  it("throws without DATABASE_URL", () => {
    expect(() => backupConfiguredDatabase({}, "/nowhere")).toThrow(/DATABASE_URL/);
  });
});

describe("retention", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const name = (daysAgo: number) => backupFileName("/repo/prisma/dev.db", new Date(now.getTime() - daysAgo * 86_400_000));

  it("reads a backup's time from its name, and nothing else", () => {
    expect(backupTime("dev-20261021-020304Z.db")).toEqual(new Date("2026-10-21T02:03:04Z"));
    expect(backupTime("dev-20261021-020304Z.db", "other")).toBeNull();
    for (const n of ["notes.txt", ".dev-20261021-020304Z.db.icloud", "dev.db"]) expect(backupTime(n)).toBeNull();
  });

  it("keeps the newest 10 plus the newest of each of the last 8 weeks", () => {
    const names = Array.from({ length: 40 }, (_, d) => name(d + 0.5)); // one a day, 40 days back
    const keep = backupsToKeep(names, now);
    // The 10 newest (0.5 to 9.5 days ago) ...
    for (let d = 0; d < 10; d++) expect(keep.has(name(d + 0.5))).toBe(true);
    // ... plus the newest in weeks 2-6 (weeks 0-1 are already covered by the newest 10); 40 days reaches into week 6.
    for (const d of [14.5, 21.5, 28.5, 35.5]) expect(keep.has(name(d))).toBe(true);
    expect(keep.size).toBe(14);
    expect(keep.has(name(11.5))).toBe(false);
  });

  it("drops a backup older than 8 weeks unless it's among the newest 10", () => {
    expect(backupsToKeep([name(70)], now).has(name(70))).toBe(true); // only backup: in the newest 10
    const many = [...Array.from({ length: 10 }, (_, d) => name(d + 0.5)), name(70)];
    expect(backupsToKeep(many, now).has(name(70))).toBe(false);
  });

  it("prunes a folder by the rule and never touches other files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "prune-"));
    const names = Array.from({ length: 15 }, (_, d) => name(d + 0.5));
    for (const n of [...names, "notes.txt", "other-20261001-000000Z.db"]) writeFileSync(path.join(dir, n), "x");
    const removed = pruneBackups(dir, "dev", now);
    expect(removed.sort()).toEqual([name(11.5), name(12.5), name(13.5), name(10.5)].sort());
    expect(readdirSync(dir)).toContain("notes.txt");
    expect(readdirSync(dir)).toContain("other-20261001-000000Z.db");
  });

  it("is applied to both folders by every configured backup", () => {
    const root = mkdtempSync(path.join(tmpdir(), "project-"));
    mkdirSync(path.join(root, "prisma", "backups"), { recursive: true });
    mkdirSync(path.join(root, "icloud"));
    const d = new DatabaseSync(path.join(root, "prisma", "dev.db"));
    d.exec(`CREATE TABLE "OddsQuote" (id TEXT)`);
    d.close();
    const old = Array.from({ length: 12 }, (_, i) => backupFileName("dev.db", new Date(Date.now() - (i + 1) * 3_600_000)));
    for (const n of old) {
      writeFileSync(path.join(root, "prisma", "backups", n), "x");
      writeFileSync(path.join(root, "icloud", n), "x");
    }
    const r = backupConfiguredDatabase({ DATABASE_URL: "file:./dev.db", DB_BACKUP_COPY_DIR: path.join(root, "icloud") }, root);
    expect(readdirSync(path.join(root, "prisma", "backups"))).toHaveLength(10);
    expect(readdirSync(path.join(root, "icloud"))).toHaveLength(10);
    expect(readdirSync(path.join(root, "icloud"))).toContain(path.basename(r.backup.path));
    expect(r.pruned.local).toHaveLength(3);
  });
});
