CREATE TABLE "SleeperRanking" (
  "id"            TEXT    NOT NULL PRIMARY KEY,
  "leagueId"      TEXT    NOT NULL,
  "sleeperUserId" TEXT    NOT NULL,
  "displayName"   TEXT    NOT NULL,
  "teamName"      TEXT,
  "totalWins"     INTEGER NOT NULL DEFAULT 0,
  "totalLosses"   INTEGER NOT NULL DEFAULT 0,
  "totalTies"     INTEGER NOT NULL DEFAULT 0,
  "winPct"        REAL    NOT NULL DEFAULT 0,
  "seasonsPlayed" INTEGER NOT NULL DEFAULT 0,
  "syncedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SleeperRanking_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SleeperRanking_leagueId_sleeperUserId_key"
  ON "SleeperRanking"("leagueId", "sleeperUserId");

CREATE INDEX "SleeperRanking_leagueId_winPct_idx"
  ON "SleeperRanking"("leagueId", "winPct");
