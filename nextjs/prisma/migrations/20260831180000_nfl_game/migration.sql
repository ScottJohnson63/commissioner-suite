-- Which teams play each other in a given week, and where.
--
-- Nothing in the app knew this. Sleeper's /schedule endpoint now 404s, and
-- nflverse ships schedules as a parquet download unsuitable for a request path,
-- so the fixtures are synced here and read from the database.
--
-- Three features depend on it, all of which previously guessed: weather (which
-- used each player's own home stadium regardless of where the game was), the
-- opponent-defense lookup (removed entirely because nothing supplied an
-- opponent), and Vegas lines (rendered unfiltered, first three on the slate).
--
-- `location` is not decoration: week 1 of 2026 has San Francisco at Los Angeles
-- played in Melbourne, where the home team's coordinates are simply wrong.
CREATE TABLE IF NOT EXISTS "NflGame" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "season"     INTEGER NOT NULL,
  "week"       INTEGER NOT NULL,
  "seasonType" TEXT,
  "homeTeam"   TEXT NOT NULL,
  "awayTeam"   TEXT NOT NULL,
  -- ISO-8601 local kickoff, e.g. "2026-09-13T13:00". Lets the forecast be read
  -- at the hour the game starts instead of guessing at Sunday afternoon.
  "kickoff"    TEXT,
  "stadium"    TEXT,
  -- outdoors | dome | closed
  "roof"       TEXT,
  -- Home | Neutral
  "location"   TEXT,
  "homeScore"  REAL,
  "awayScore"  REAL,
  "syncedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "NflGame_season_week_homeTeam_key"
  ON "NflGame" ("season", "week", "homeTeam");
CREATE INDEX IF NOT EXISTS "NflGame_season_week_idx" ON "NflGame" ("season", "week");
