-- Recreates the indexes that 20260823000000_prune_schema_add_sync_run defines
-- but could not create against Turso.
--
-- In that migration the CREATE INDEX statements follow a DROP TABLE / RENAME in
-- the same run. Turso rejected the first of them with "index already exists"
-- even though sqlite_master showed no such index — the dropped table's index
-- names were still held in a stale schema view. The abort left the three
-- NflWeeklyStat indexes and both SyncRun indexes uncreated.
--
-- NflWeeklyStat_season_week_playerId_key is the one that matters most:
-- python/scripts/common/nflstats.py upserts with
-- ON CONFLICT (season, week, "playerId"), which SQLite rejects outright unless a
-- matching unique index exists.
--
-- IF NOT EXISTS throughout so this is safe to re-run and is a no-op on any
-- database where the parent migration completed normally.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NflWeeklyStat_position_season_idx" ON "NflWeeklyStat"("position", "season");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NflWeeklyStat_team_season_idx" ON "NflWeeklyStat"("team", "season");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NflWeeklyStat_season_week_playerId_key" ON "NflWeeklyStat"("season", "week", "playerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncRun_source_startedAt_idx" ON "SyncRun"("source", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");
