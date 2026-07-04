-- AlterTable
ALTER TABLE "BankrollEntry" ADD COLUMN "teamParlayId" TEXT;

-- CreateTable
CREATE TABLE "TeamParlay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stake" REAL NOT NULL DEFAULT 5,
    "combinedDecimal" REAL NOT NULL DEFAULT 1,
    "combinedAmerican" INTEGER NOT NULL DEFAULT 100,
    "projectedPayout" REAL NOT NULL DEFAULT 0,
    "actualPayout" REAL,
    "profitLoss" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "placedReal" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TeamParlayLeg" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamParlayId" TEXT NOT NULL,
    "teamPickId" TEXT NOT NULL,
    "priceAmerican" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "TeamParlayLeg_teamParlayId_fkey" FOREIGN KEY ("teamParlayId") REFERENCES "TeamParlay" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TeamParlayLeg_teamPickId_fkey" FOREIGN KEY ("teamPickId") REFERENCES "TeamPick" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeamParlay_date_idx" ON "TeamParlay"("date");
