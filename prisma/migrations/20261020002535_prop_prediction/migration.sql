-- CreateTable
CREATE TABLE "PropPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerPropId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quotedAt" DATETIME NOT NULL,
    "line" REAL NOT NULL,
    "lineKind" TEXT NOT NULL,
    "modelProbOver" REAL NOT NULL,
    "modelRawProbOver" REAL,
    "marketProbOver" REAL NOT NULL,
    "marketMethod" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "edgeSource" TEXT NOT NULL,
    "playerStatus" TEXT,
    "teammateOut" BOOLEAN,
    CONSTRAINT "PropPrediction_playerPropId_fkey" FOREIGN KEY ("playerPropId") REFERENCES "PlayerProp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PropPrediction_playerPropId_createdAt_idx" ON "PropPrediction"("playerPropId", "createdAt");

-- CreateIndex
CREATE INDEX "PropPrediction_source_modelVersion_idx" ON "PropPrediction"("source", "modelVersion");
