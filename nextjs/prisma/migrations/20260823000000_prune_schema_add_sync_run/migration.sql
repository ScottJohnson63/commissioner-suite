-- Prunes schema surface that nothing reads, and adds SyncRun.
--
--   Session, VerificationToken  — NextAuth runs the JWT session strategy with
--                                 no PrismaAdapter, so these were never written.
--   User.emailVerified          — never referenced.
--   League.divisionCount        — written as the constant 2 and never read back;
--                                 the 2-division rule is enforced in code.
--   NflWeeklyStat               — 58 stat columns that no app query selected.
--
-- The table rebuilds below copy every retained column, so no live row data is
-- lost. IF EXISTS guards keep this runnable against databases created by
-- `prisma db push`, which may not carry every named index.

-- DropIndex
DROP INDEX IF EXISTS "Session_sessionToken_key";

-- DropIndex
DROP INDEX IF EXISTS "VerificationToken_token_key";

-- DropIndex
DROP INDEX IF EXISTS "VerificationToken_identifier_token_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "Session";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE IF EXISTS "VerificationToken";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "image" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "sleeperUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "id", "image", "name", "password", "role", "sleeperUserId", "updatedAt", "username") SELECT "createdAt", "email", "id", "image", "name", "password", "role", "sleeperUserId", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sleeperLeagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "season" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rankedSeasonIds" TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO "new_League" ("createdAt", "id", "name", "rankedSeasonIds", "season", "sleeperLeagueId") SELECT "createdAt", "id", "name", "rankedSeasonIds", "season", "sleeperLeagueId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_sleeperLeagueId_key" ON "League"("sleeperLeagueId");
CREATE TABLE "new_NflWeeklyStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT,
    "playerDisplayName" TEXT,
    "position" TEXT,
    "positionGroup" TEXT,
    "headshot" TEXT,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "seasonType" TEXT,
    "team" TEXT,
    "opponentTeam" TEXT,
    "completions" REAL,
    "attempts" REAL,
    "passingYards" REAL,
    "passingTds" REAL,
    "passingInterceptions" REAL,
    "sacksSuffered" REAL,
    "passingAirYards" REAL,
    "passingYardsAfterCatch" REAL,
    "passingFirstDowns" REAL,
    "passingEpa" REAL,
    "passingCpoe" REAL,
    "pacr" REAL,
    "carries" REAL,
    "rushingYards" REAL,
    "rushingTds" REAL,
    "rushingFirstDowns" REAL,
    "rushingEpa" REAL,
    "receptions" REAL,
    "targets" REAL,
    "receivingYards" REAL,
    "receivingTds" REAL,
    "receivingAirYards" REAL,
    "receivingYardsAfterCatch" REAL,
    "receivingFirstDowns" REAL,
    "receivingEpa" REAL,
    "racr" REAL,
    "targetShare" REAL,
    "airYardsShare" REAL,
    "wopr" REAL,
    "defTacklesSolo" REAL,
    "defTacklesForLoss" REAL,
    "defFumblesForced" REAL,
    "defSacks" REAL,
    "defQbHits" REAL,
    "defInterceptions" REAL,
    "defPassDefended" REAL,
    "defTds" REAL,
    "fgMade" REAL,
    "fgAtt" REAL,
    "patMade" REAL,
    "fantasyPoints" REAL,
    "fantasyPointsPpr" REAL
);
INSERT INTO "new_NflWeeklyStat" ("airYardsShare", "attempts", "carries", "completions", "defFumblesForced", "defInterceptions", "defPassDefended", "defQbHits", "defSacks", "defTacklesForLoss", "defTacklesSolo", "defTds", "fantasyPoints", "fantasyPointsPpr", "fgAtt", "fgMade", "headshot", "id", "opponentTeam", "pacr", "passingAirYards", "passingCpoe", "passingEpa", "passingFirstDowns", "passingInterceptions", "passingTds", "passingYards", "passingYardsAfterCatch", "patMade", "playerDisplayName", "playerId", "playerName", "position", "positionGroup", "racr", "receivingAirYards", "receivingEpa", "receivingFirstDowns", "receivingTds", "receivingYards", "receivingYardsAfterCatch", "receptions", "rushingEpa", "rushingFirstDowns", "rushingTds", "rushingYards", "sacksSuffered", "season", "seasonType", "targetShare", "targets", "team", "week", "wopr") SELECT "airYardsShare", "attempts", "carries", "completions", "defFumblesForced", "defInterceptions", "defPassDefended", "defQbHits", "defSacks", "defTacklesForLoss", "defTacklesSolo", "defTds", "fantasyPoints", "fantasyPointsPpr", "fgAtt", "fgMade", "headshot", "id", "opponentTeam", "pacr", "passingAirYards", "passingCpoe", "passingEpa", "passingFirstDowns", "passingInterceptions", "passingTds", "passingYards", "passingYardsAfterCatch", "patMade", "playerDisplayName", "playerId", "playerName", "position", "positionGroup", "racr", "receivingAirYards", "receivingEpa", "receivingFirstDowns", "receivingTds", "receivingYards", "receivingYardsAfterCatch", "receptions", "rushingEpa", "rushingFirstDowns", "rushingTds", "rushingYards", "sacksSuffered", "season", "seasonType", "targetShare", "targets", "team", "week", "wopr" FROM "NflWeeklyStat";
DROP TABLE "NflWeeklyStat";
ALTER TABLE "new_NflWeeklyStat" RENAME TO "NflWeeklyStat";
CREATE INDEX "NflWeeklyStat_season_week_idx" ON "NflWeeklyStat"("season", "week");
CREATE INDEX "NflWeeklyStat_playerId_idx" ON "NflWeeklyStat"("playerId");
CREATE INDEX "NflWeeklyStat_position_season_idx" ON "NflWeeklyStat"("position", "season");
CREATE INDEX "NflWeeklyStat_team_season_idx" ON "NflWeeklyStat"("team", "season");
CREATE UNIQUE INDEX "NflWeeklyStat_season_week_playerId_key" ON "NflWeeklyStat"("season", "week", "playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SyncRun_source_startedAt_idx" ON "SyncRun"("source", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

