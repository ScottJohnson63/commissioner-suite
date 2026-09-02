-- Makes card ownership exclusive.
--
-- The game is a race for scarce cards, not a completion challenge: one card has
-- exactly one owner for a season. That is enforced by moving the unique key
-- from (userId, gameSeason, cardId) to (gameSeason, cardId) — dropping userId
-- out of it is the whole change.
--
-- `count` goes with it. It existed to record duplicates, and under exclusive
-- ownership a duplicate cannot happen.
--
-- SQLite cannot alter a constraint in place, so the table is rebuilt and the
-- rows copied across — the same approach as migrate-turso.ts took for User.
--
-- Existing rows survive. Should any two members already hold the same card
-- from before this rule existed, the INSERT..SELECT keeps whoever claimed it
-- first and drops the later claim, which is the rule this migration
-- establishes applied retroactively.

CREATE TABLE "CardOwnership_new" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "userId"     TEXT     NOT NULL,
    "gameSeason" INTEGER  NOT NULL,
    "cardId"     TEXT     NOT NULL,
    "claimedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "CardOwnership_new" ("id", "userId", "gameSeason", "cardId", "claimedAt")
SELECT "id", "userId", "gameSeason", "cardId", "firstPulledAt"
  FROM "CardOwnership"
 WHERE "id" IN (
   -- One row per (season, card): the earliest claim wins.
   SELECT "id" FROM "CardOwnership" o
    WHERE "firstPulledAt" = (
      SELECT MIN("firstPulledAt") FROM "CardOwnership" i
       WHERE i."gameSeason" = o."gameSeason" AND i."cardId" = o."cardId"
    )
   GROUP BY "gameSeason", "cardId"
 );

DROP TABLE "CardOwnership";
ALTER TABLE "CardOwnership_new" RENAME TO "CardOwnership";

CREATE UNIQUE INDEX "CardOwnership_gameSeason_cardId_key" ON "CardOwnership"("gameSeason", "cardId");
CREATE INDEX "CardOwnership_userId_gameSeason_idx" ON "CardOwnership"("userId", "gameSeason");
