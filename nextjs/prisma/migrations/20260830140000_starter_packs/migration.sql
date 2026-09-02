-- Starter packs: a one-off welcome grant, separate from the weekly ration.
--
-- Five packs the first time a member opens the game, two of them guaranteed
-- Gold or better. They do not recur and they are not part of the weekly five.
--
-- Scoped to (userId, gameSeason) rather than to the account, so the end-of-
-- season reset hands out a fresh set along with the cleared decks: a member
-- coming back to nothing needs the same leg up as a brand new one.
--
-- PackOpening's isBonus flag becomes `kind`, because there are now three
-- supplies rather than two. Both the starter grant and the weekly ration
-- promise a number of Gold-or-better packs, and each promise is about its own
-- supply -- so "which supply did this come from" is the question the column
-- has to answer, and a boolean cannot.

CREATE TABLE IF NOT EXISTS "StarterGrant" (
    "id"           TEXT     NOT NULL PRIMARY KEY,
    "userId"       TEXT     NOT NULL,
    "gameSeason"   INTEGER  NOT NULL,
    "packsGranted" INTEGER  NOT NULL DEFAULT 0,
    "packsOpened"  INTEGER  NOT NULL DEFAULT 0,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "StarterGrant_userId_gameSeason_key" ON "StarterGrant"("userId", "gameSeason");

ALTER TABLE "PackOpening" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'RATION';

UPDATE "PackOpening" SET "kind" = CASE WHEN "isBonus" = 1 THEN 'BONUS' ELSE 'RATION' END;

ALTER TABLE "PackOpening" DROP COLUMN "isBonus";
