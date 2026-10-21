-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PropPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerPropId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quotedAt" DATETIME,
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
INSERT INTO "new_PropPrediction" ("createdAt", "edgeSource", "id", "line", "lineKind", "marketMethod", "marketProbOver", "modelProbOver", "modelRawProbOver", "modelVersion", "playerPropId", "playerStatus", "quotedAt", "source", "teammateOut") SELECT "createdAt", "edgeSource", "id", "line", "lineKind", "marketMethod", "marketProbOver", "modelProbOver", "modelRawProbOver", "modelVersion", "playerPropId", "playerStatus", "quotedAt", "source", "teammateOut" FROM "PropPrediction";
DROP TABLE "PropPrediction";
ALTER TABLE "new_PropPrediction" RENAME TO "PropPrediction";
CREATE INDEX "PropPrediction_playerPropId_createdAt_idx" ON "PropPrediction"("playerPropId", "createdAt");
CREATE INDEX "PropPrediction_source_modelVersion_idx" ON "PropPrediction"("source", "modelVersion");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
