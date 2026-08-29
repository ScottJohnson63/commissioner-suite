-- Adds per-league scoping to SyncRun.
--
-- The Data Sync page now syncs the league chosen in the header dropdown, so
-- "last run" has to be answerable per league. Existing rows predate the idea of
-- a scoped run and stay NULL, which reads correctly as "swept every league".
--
-- ADD COLUMN is one of the few ALTERs SQLite supports outright, so no table
-- rebuild is needed here.

ALTER TABLE "SyncRun" ADD COLUMN "leagueId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncRun_source_leagueId_startedAt_idx" ON "SyncRun"("source", "leagueId", "startedAt");
