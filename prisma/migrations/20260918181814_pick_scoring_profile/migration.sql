-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Pick" (
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
    "scoringProfile" TEXT NOT NULL DEFAULT 'balanced',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actualResult" REAL,
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "entryProb" REAL,
    "closingProb" REAL,
    "closingCapturedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pick_playerPropId_fkey" FOREIGN KEY ("playerPropId") REFERENCES "PlayerProp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Pick" ("actualResult", "closingCapturedAt", "closingProb", "confidenceScore", "createdAt", "date", "deepDiveAnalysis", "edgeScore", "entryProb", "evidenceJson", "id", "isDemo", "modelVersion", "placedReal", "playerPropId", "rank", "reasoningSummary", "reasonsAgainstJson", "reasonsForJson", "recommendedStake", "riskLevel", "scoreBreakdownJson", "status", "tagsJson", "updatedAt", "userNote", "verdict", "warningsJson") SELECT "actualResult", "closingCapturedAt", "closingProb", "confidenceScore", "createdAt", "date", "deepDiveAnalysis", "edgeScore", "entryProb", "evidenceJson", "id", "isDemo", "modelVersion", "placedReal", "playerPropId", "rank", "reasoningSummary", "reasonsAgainstJson", "reasonsForJson", "recommendedStake", "riskLevel", "scoreBreakdownJson", "status", "tagsJson", "updatedAt", "userNote", "verdict", "warningsJson" FROM "Pick";
DROP TABLE "Pick";
ALTER TABLE "new_Pick" RENAME TO "Pick";
CREATE INDEX "Pick_date_idx" ON "Pick"("date");
CREATE INDEX "Pick_status_idx" ON "Pick"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
