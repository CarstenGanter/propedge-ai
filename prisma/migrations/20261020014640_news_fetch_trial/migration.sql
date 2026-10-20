-- CreateTable
CREATE TABLE "NewsFetch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changeId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "kickoff" DATETIME NOT NULL,
    "team" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "creditsReserved" INTEGER NOT NULL,
    "creditsSpent" INTEGER,
    "quotes" INTEGER,
    "note" TEXT,
    "executedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "NewsFetch_status_dueAt_idx" ON "NewsFetch"("status", "dueAt");
