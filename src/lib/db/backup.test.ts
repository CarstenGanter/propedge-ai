import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupConfiguredDatabase, backupDatabase, backupFileName, copyOffsite, resolveDbPath, secretValues } from "./backup";

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
