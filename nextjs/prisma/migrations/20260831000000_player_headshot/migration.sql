-- Resolved portraits for the card game.
--
-- NflWeeklyStat.headshot is nflverse's headshot_url, which is an nfl.com
-- Cloudinary link. For roughly half the card pool that link answers 200 with
-- the league's generic faceless-helmet silhouette rather than a photograph, so
-- "the column is not null" never meant "there is a picture" — and because the
-- response is a 200, the card's own onError fallback never fired either.
--
-- This table holds the answer to "what should this player's card actually
-- show": a photograph that was verified to be one, or NULL meaning there is no
-- photograph anywhere and the card should fall back to its team logo. It is
-- keyed on the player rather than on (season, player) because a portrait is a
-- property of the man, not of the year — the same picture serves every card he
-- has. Filled by python/scripts/sync_player_headshots.py.

CREATE TABLE "NflPlayerHeadshot" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "playerId"  TEXT NOT NULL,
    "url"       TEXT,
    "source"    TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "NflPlayerHeadshot_playerId_key" ON "NflPlayerHeadshot"("playerId");
