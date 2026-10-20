-- CreateTable
CREATE TABLE "InjuryStatusChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "detectedAt" DATETIME NOT NULL,
    "eventId" TEXT NOT NULL,
    "kickoff" DATETIME NOT NULL,
    "team" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "position" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "rawStatus" TEXT
);

-- CreateIndex
CREATE INDEX "InjuryStatusChange_eventId_team_playerName_detectedAt_idx" ON "InjuryStatusChange"("eventId", "team", "playerName", "detectedAt");

-- CreateIndex
CREATE INDEX "InjuryStatusChange_toStatus_detectedAt_idx" ON "InjuryStatusChange"("toStatus", "detectedAt");
