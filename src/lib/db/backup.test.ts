import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupDatabase, backupFileName, resolveDbPath } from "./backup";

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
