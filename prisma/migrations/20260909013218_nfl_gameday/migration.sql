-- CreateTable
CREATE TABLE "ProviderCache" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "json" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

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
    "leaguesEnabledJson" TEXT NOT NULL DEFAULT '["NFL","MLB","CBB","WNBA","EPL","Bundesliga","UCL","WorldCup"]',
    "minTeamConfidence" INTEGER NOT NULL DEFAULT 55,
    "nflMarketsJson" TEXT NOT NULL DEFAULT '["Passing Yards","Rushing Yards","Receiving Yards","Receptions","Pass TDs","Rush+Rec Yards"]',
    "nflMaxGames" INTEGER NOT NULL DEFAULT 16,
    "oddsCreditFloor" INTEGER NOT NULL DEFAULT 25,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "leaguesEnabledJson", "maxDailyPicks", "minConfidenceThreshold", "minTeamConfidence", "scoringProfile", "sportsEnabledJson", "updatedAt") SELECT "bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "leaguesEnabledJson", "maxDailyPicks", "minConfidenceThreshold", "minTeamConfidence", "scoringProfile", "sportsEnabledJson", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
