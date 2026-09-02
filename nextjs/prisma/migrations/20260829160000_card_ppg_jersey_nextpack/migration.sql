-- Per-game scoring, jersey numbers, and the pre-rolled next pack.
--
-- Three unrelated additions that happen to land together.
--
-- 1. CardDefinition gains gamesPlayed and pointsPerGame. nflverse has no
--    per-game fantasy column, but its season summary carries a `games` count,
--    and that count is exactly the number of weekly rows the player has in
--    NflWeeklyStat -- verified equal for all 2,019 players of 2025. So games
--    are counted from rows already stored and no new stat sync is needed.
--    pointsPerGame is stored rather than divided on read so the card, the API
--    and any future sort all agree, and a zero-game row cannot yield NaN.
--
-- 2. CardDefinition gains jerseyNumber, filled from the new NflSeasonRoster
--    table. Jersey numbers are on nflverse's roster feed, not the player-stat
--    feed, so they need their own sync -- see sync_nfl_rosters.py.
--
-- 3. PackGrant gains nextPackTier, so the sealed pack can show what it is
--    before it is torn open. Rolled once and stored, never at render time: a
--    tier decided on render would change on every reload and a member would
--    refresh until a Hall of Fame pack turned up.
--
-- All additive. Existing rows read NULL or the default until the next pool
-- rebuild fills them in.

ALTER TABLE "CardDefinition" ADD COLUMN "gamesPlayed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CardDefinition" ADD COLUMN "pointsPerGame" REAL NOT NULL DEFAULT 0;
ALTER TABLE "CardDefinition" ADD COLUMN "jerseyNumber" INTEGER;

ALTER TABLE "PackGrant" ADD COLUMN "nextPackTier" TEXT;

CREATE TABLE IF NOT EXISTS "NflSeasonRoster" (
    "id"           TEXT     NOT NULL PRIMARY KEY,
    "season"       INTEGER  NOT NULL,
    "playerId"     TEXT     NOT NULL,
    "jerseyNumber" INTEGER,
    "team"         TEXT,
    "syncedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "NflSeasonRoster_season_playerId_key" ON "NflSeasonRoster"("season", "playerId");
CREATE INDEX IF NOT EXISTS "NflSeasonRoster_season_idx" ON "NflSeasonRoster"("season");
