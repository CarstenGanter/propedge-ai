-- AlterTable
ALTER TABLE "BankrollEntry" ADD COLUMN "teamPickId" TEXT;

-- CreateTable
CREATE TABLE "TeamPick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "gameId" TEXT,
    "gameStartTime" DATETIME,
    "recommendedSide" TEXT NOT NULL,
    "recommendedTeam" TEXT NOT NULL,
    "winProbability" REAL NOT NULL,
    "marketWinProb" REAL NOT NULL,
    "valueEdge" REAL NOT NULL,
    "priceAmerican" REAL,
    "confidenceScore" REAL NOT NULL,
    "edgeScore" REAL NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "reasoningSummary" TEXT NOT NULL DEFAULT '',
    "deepDiveAnalysis" TEXT NOT NULL DEFAULT '',
    "verdict" TEXT NOT NULL DEFAULT '',
    "scoreBreakdownJson" TEXT NOT NULL DEFAULT '{}',
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "reasonsForJson" TEXT NOT NULL DEFAULT '[]',
    "reasonsAgainstJson" TEXT NOT NULL DEFAULT '[]',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "userNote" TEXT,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1.0.0',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actualWinner" TEXT,
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "maxDailyPicks", "minConfidenceThreshold", "scoringProfile", "sportsEnabledJson", "updatedAt") SELECT "bankrollStartingAmount", "createdAt", "defaultStake", "demoMode", "enableWebResearch", "id", "maxDailyPicks", "minConfidenceThreshold", "scoringProfile", "sportsEnabledJson", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TeamPick_date_idx" ON "TeamPick"("date");

-- CreateIndex
CREATE INDEX "TeamPick_league_idx" ON "TeamPick"("league");

-- CreateIndex
CREATE INDEX "TeamPick_status_idx" ON "TeamPick"("status");
