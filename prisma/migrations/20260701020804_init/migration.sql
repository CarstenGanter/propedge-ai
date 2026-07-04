-- CreateTable
CREATE TABLE "PlayerProp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "gameId" TEXT,
    "gameStartTime" DATETIME,
    "propType" TEXT NOT NULL,
    "line" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "projection" REAL,
    "payoutMultiplier" REAL,
    "injuryStatus" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actualResult" REAL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Pick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerPropId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "confidenceScore" REAL NOT NULL,
    "edgeScore" REAL NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "recommendedStake" REAL NOT NULL,
    "reasoningSummary" TEXT NOT NULL,
    "deepDiveAnalysis" TEXT NOT NULL,
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
    "actualResult" REAL,
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pick_playerPropId_fkey" FOREIGN KEY ("playerPropId") REFERENCES "PlayerProp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pickId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceName" TEXT,
    "confidenceImpact" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankrollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "pickId" TEXT,
    "parlayId" TEXT,
    "entryType" TEXT NOT NULL,
    "stake" REAL NOT NULL DEFAULT 0,
    "payout" REAL NOT NULL DEFAULT 0,
    "profitLoss" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankrollEntry_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Parlay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stake" REAL NOT NULL DEFAULT 5,
    "payoutMultiplier" REAL NOT NULL DEFAULT 1,
    "projectedPayout" REAL NOT NULL DEFAULT 0,
    "actualPayout" REAL,
    "profitLoss" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ParlayLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parlayId" TEXT NOT NULL,
    "pickId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "ParlayLeg_parlayId_fkey" FOREIGN KEY ("parlayId") REFERENCES "Parlay" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParlayLeg_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "Pick" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "defaultStake" REAL NOT NULL DEFAULT 5,
    "bankrollStartingAmount" REAL NOT NULL DEFAULT 100,
    "sportsEnabledJson" TEXT NOT NULL DEFAULT '["NFL","NBA","NCAAB","MLB","WNBA","NHL","Soccer"]',
    "minConfidenceThreshold" INTEGER NOT NULL DEFAULT 65,
    "maxDailyPicks" INTEGER NOT NULL DEFAULT 10,
    "demoMode" BOOLEAN NOT NULL DEFAULT true,
    "enableWebResearch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LineSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerPropId" TEXT NOT NULL,
    "line" REAL NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineSnapshot_playerPropId_fkey" FOREIGN KEY ("playerPropId") REFERENCES "PlayerProp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AvoidListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PlayerProp_date_idx" ON "PlayerProp"("date");

-- CreateIndex
CREATE INDEX "PlayerProp_sport_idx" ON "PlayerProp"("sport");

-- CreateIndex
CREATE INDEX "Pick_date_idx" ON "Pick"("date");

-- CreateIndex
CREATE INDEX "Pick_status_idx" ON "Pick"("status");

-- CreateIndex
CREATE INDEX "BankrollEntry_date_idx" ON "BankrollEntry"("date");

-- CreateIndex
CREATE INDEX "Parlay_date_idx" ON "Parlay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AvoidListItem_type_value_key" ON "AvoidListItem"("type", "value");
