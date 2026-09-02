-- The wildcard becomes a card you pull rather than a weekly entitlement.
--
-- PackGrant.wildcardRoll held one throw per member per week, granted whether or
-- not a pack had been opened. Wildcards are now found in Silver, Gold and Hall
-- of Fame packs, so a member can hold several at once and each is thrown on its
-- own — which a single nullable column on the weekly grant cannot express.
--
-- Any unthrown die from the old scheme is dropped with the column. The packs a
-- thrown die already granted stay: they were added to packsGranted at the
-- moment of the roll, so that number needs no correction.

CREATE TABLE "WildcardCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "gameSeason" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "pulledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledValue" INTEGER,
    "rolledAt" DATETIME
);

CREATE INDEX "WildcardCard_userId_gameSeason_idx" ON "WildcardCard"("userId", "gameSeason");

ALTER TABLE "PackGrant" DROP COLUMN "wildcardRoll";
