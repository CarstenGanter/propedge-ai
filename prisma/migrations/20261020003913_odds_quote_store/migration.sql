/*
  Warnings:

  - You are about to drop the `LineSnapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "LineSnapshot";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "OddsQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fetchedAt" DATETIME NOT NULL,
    "fetchKind" TEXT NOT NULL,
    "sportKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "commenceTime" DATETIME NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "propType" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "line" REAL NOT NULL,
    "over" INTEGER,
    "under" INTEGER,
    "bookUpdatedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "OddsQuote_eventId_playerName_propType_fetchedAt_idx" ON "OddsQuote"("eventId", "playerName", "propType", "fetchedAt");

-- CreateIndex
CREATE INDEX "OddsQuote_fetchedAt_idx" ON "OddsQuote"("fetchedAt");
