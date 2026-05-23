-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperLeagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "season" INTEGER NOT NULL,
    "divisionCount" INTEGER NOT NULL DEFAULT 2,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_League" ("createdAt", "divisionCount", "id", "season", "sleeperLeagueId") SELECT "createdAt", "divisionCount", "id", "season", "sleeperLeagueId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_sleeperLeagueId_key" ON "League"("sleeperLeagueId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
