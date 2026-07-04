-- AlterTable
ALTER TABLE "Pick" ADD COLUMN "closingCapturedAt" DATETIME;
ALTER TABLE "Pick" ADD COLUMN "closingProb" REAL;
ALTER TABLE "Pick" ADD COLUMN "entryProb" REAL;

-- AlterTable
ALTER TABLE "TeamPick" ADD COLUMN "closingCapturedAt" DATETIME;
ALTER TABLE "TeamPick" ADD COLUMN "closingPrice" REAL;
ALTER TABLE "TeamPick" ADD COLUMN "closingWinProb" REAL;
