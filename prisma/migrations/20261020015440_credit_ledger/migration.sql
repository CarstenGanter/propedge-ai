-- CreateTable
CREATE TABLE "CreditSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER,
    "endpoint" TEXT NOT NULL,
    "status" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "CreditSpend_at_idx" ON "CreditSpend"("at");
