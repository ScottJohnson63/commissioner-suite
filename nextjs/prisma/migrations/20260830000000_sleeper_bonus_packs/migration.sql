-- Bonus packs earned from Sleeper results.
--
-- Two rules, each worth one pack a week: win a matchup, or score over the
-- points threshold. The unique key on (userId, gameSeason, week, kind) is what
-- makes "once per week" true regardless of how many Sleeper leagues a member
-- plays in -- winning in four leagues is one win pack, not four.
--
-- PackGrant gains its own counters rather than folding bonus packs into
-- packsGranted, because a bonus pack is a different pack: ten cards instead of
-- five, and never below Silver. The opener has to know which kind is next.
--
-- All additive.

ALTER TABLE "PackGrant" ADD COLUMN "bonusGranted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PackGrant" ADD COLUMN "bonusOpened" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "PackBonus" (
    "id"              TEXT     NOT NULL PRIMARY KEY,
    "userId"          TEXT     NOT NULL,
    "gameSeason"      INTEGER  NOT NULL,
    "week"            INTEGER  NOT NULL,
    "kind"            TEXT     NOT NULL,
    "sleeperLeagueId" TEXT,
    "points"          REAL,
    "awardedAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PackBonus_userId_gameSeason_week_kind_key" ON "PackBonus"("userId", "gameSeason", "week", "kind");
CREATE INDEX IF NOT EXISTS "PackBonus_userId_gameSeason_idx" ON "PackBonus"("userId", "gameSeason");
