-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CreditSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "credits" INTEGER,
    "remaining" INTEGER,
    "endpoint" TEXT NOT NULL,
    "status" INTEGER NOT NULL
);
INSERT INTO "new_CreditSpend" ("at", "credits", "endpoint", "id", "kind", "remaining", "status") SELECT "at", "credits", "endpoint", "id", "kind", "remaining", "status" FROM "CreditSpend";
DROP TABLE "CreditSpend";
ALTER TABLE "new_CreditSpend" RENAME TO "CreditSpend";
CREATE INDEX "CreditSpend_at_idx" ON "CreditSpend"("at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
