-- AlterTable
ALTER TABLE "PlayerProp" ADD COLUMN "marketDataJson" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "defaultStake" REAL NOT NULL DEFAULT 5,
    "bankrollStartingAmount" REAL NOT NULL DEFAULT 100,
    "sportsEnabledJson" TEXT NOT NULL DEFAULT '["NFL","NBA","NCAAB","MLB","WNBA","NHL","Soccer"]',
    "minConfidenceThreshold" INTEGER NOT NULL DEFAULT 65,
    "maxDailyPicks" INTEGER NOT NULL DEFAULT 10,
    "demoMode" BOOLEAN NOT NULL DEFAULT true,
    "enableWebResearch" BOOLEAN NOT NULL DEFAULT false,
    "scoringProfile" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "maxDailyPicks", "minConfidenceThreshold", "sportsEnabledJson", "updatedAt") SELECT "bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "maxDailyPicks", "minConfidenceThreshold", "sportsEnabledJson", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
