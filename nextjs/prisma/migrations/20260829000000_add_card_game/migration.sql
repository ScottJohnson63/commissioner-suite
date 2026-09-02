-- Ultimate Team card collection game.
--
-- Four tables, all additive — nothing existing is touched.
--
-- CardDefinition is derived data, rebuilt from NflWeeklyStat by the pool
-- builder. The three user-owned tables reference cards by id as a plain TEXT
-- column with no foreign key, deliberately: a rebuild deletes and recreates
-- CardDefinition rows, and a REFERENCES constraint would either cascade-delete
-- a member's collection or block the rebuild outright. The read path tolerates
-- an ownership row whose card no longer exists.
--
-- CardTier is stored as TEXT, matching how Prisma persists every other enum in
-- this schema (Role, SyncSource, …) on SQLite.

CREATE TABLE "CardDefinition" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "season"        INTEGER  NOT NULL,
    "playerId"      TEXT     NOT NULL,
    "playerName"    TEXT     NOT NULL,
    "position"      TEXT     NOT NULL,
    "team"          TEXT,
    "tier"          TEXT     NOT NULL,
    "seasonRank"    INTEGER  NOT NULL,
    "fantasyPoints" REAL     NOT NULL,
    "headshot"      TEXT,
    "builtAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CardDefinition_season_playerId_key" ON "CardDefinition"("season", "playerId");
CREATE INDEX "CardDefinition_season_tier_idx" ON "CardDefinition"("season", "tier");
CREATE INDEX "CardDefinition_tier_idx" ON "CardDefinition"("tier");

CREATE TABLE "PackGrant" (
    "id"           TEXT     NOT NULL PRIMARY KEY,
    "userId"       TEXT     NOT NULL,
    "gameSeason"   INTEGER  NOT NULL,
    "week"         INTEGER  NOT NULL,
    "packsGranted" INTEGER  NOT NULL,
    "packsOpened"  INTEGER  NOT NULL DEFAULT 0,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PackGrant_userId_gameSeason_week_key" ON "PackGrant"("userId", "gameSeason", "week");
CREATE INDEX "PackGrant_userId_gameSeason_idx" ON "PackGrant"("userId", "gameSeason");

CREATE TABLE "CardOwnership" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "userId"        TEXT     NOT NULL,
    "gameSeason"    INTEGER  NOT NULL,
    "cardId"        TEXT     NOT NULL,
    "count"         INTEGER  NOT NULL DEFAULT 1,
    "firstPulledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "CardOwnership_userId_gameSeason_cardId_key" ON "CardOwnership"("userId", "gameSeason", "cardId");
CREATE INDEX "CardOwnership_userId_gameSeason_idx" ON "CardOwnership"("userId", "gameSeason");

CREATE TABLE "PackOpening" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "userId"     TEXT     NOT NULL,
    "gameSeason" INTEGER  NOT NULL,
    "week"       INTEGER  NOT NULL,
    "packTier"   TEXT     NOT NULL,
    "cardIds"    TEXT     NOT NULL,
    "openedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PackOpening_userId_gameSeason_idx" ON "PackOpening"("userId", "gameSeason");
CREATE INDEX "PackOpening_openedAt_idx" ON "PackOpening"("openedAt");
