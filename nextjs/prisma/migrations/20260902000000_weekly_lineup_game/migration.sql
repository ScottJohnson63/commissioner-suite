-- The weekly submission game: a lineup frozen at Monday's deadline, and the
-- cards it burned. See LineupSubmission / LineupCard in schema.prisma.

CREATE TABLE IF NOT EXISTS "LineupSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "gameSeason" INTEGER NOT NULL,
  "week" INTEGER NOT NULL,
  "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockAt" DATETIME NOT NULL,
  "revealAt" DATETIME NOT NULL,
  "points" REAL NOT NULL DEFAULT 0,
  "filled" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "LineupSubmission_userId_gameSeason_week_key"
  ON "LineupSubmission"("userId", "gameSeason", "week");
CREATE INDEX IF NOT EXISTS "LineupSubmission_gameSeason_week_idx"
  ON "LineupSubmission"("gameSeason", "week");
CREATE INDEX IF NOT EXISTS "LineupSubmission_userId_gameSeason_idx"
  ON "LineupSubmission"("userId", "gameSeason");

CREATE TABLE IF NOT EXISTS "LineupCard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gameSeason" INTEGER NOT NULL,
  "week" INTEGER NOT NULL,
  "slot" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "points" REAL NOT NULL DEFAULT 0,
  CONSTRAINT "LineupCard_submissionId_fkey" FOREIGN KEY ("submissionId")
    REFERENCES "LineupSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "LineupCard_submissionId_slot_key"
  ON "LineupCard"("submissionId", "slot");
-- The retirement rule: a card plays once a season, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS "LineupCard_userId_gameSeason_cardId_key"
  ON "LineupCard"("userId", "gameSeason", "cardId");
CREATE INDEX IF NOT EXISTS "LineupCard_userId_gameSeason_idx"
  ON "LineupCard"("userId", "gameSeason");
CREATE INDEX IF NOT EXISTS "LineupCard_gameSeason_week_idx"
  ON "LineupCard"("gameSeason", "week");
