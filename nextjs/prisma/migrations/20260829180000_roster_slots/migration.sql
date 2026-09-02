-- Starting lineups.
--
-- A member's deck is everything they own; their roster is the ten cards they
-- field, and it is the roster that decides the standings.
--
-- One row per filled slot rather than ten columns on a lineup table, so the
-- shape of the lineup is a constant in one TypeScript file rather than a schema
-- change.
--
-- Two unique keys doing two different jobs. (userId, gameSeason, slot) means a
-- slot holds one card. (userId, gameSeason, cardId) means a card sits in at most
-- one slot -- which is what stops the same running back being started at both
-- RB1 and FLEX1.
--
-- No foreign key to CardDefinition, matching the other user-owned tables: the
-- pool is rebuilt wholesale and a REFERENCES constraint would either cascade
-- away lineups or block the rebuild.

CREATE TABLE IF NOT EXISTS "RosterSlot" (
    "id"         TEXT     NOT NULL PRIMARY KEY,
    "userId"     TEXT     NOT NULL,
    "gameSeason" INTEGER  NOT NULL,
    "slot"       TEXT     NOT NULL,
    "cardId"     TEXT     NOT NULL,
    "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "RosterSlot_userId_gameSeason_slot_key" ON "RosterSlot"("userId", "gameSeason", "slot");
CREATE UNIQUE INDEX IF NOT EXISTS "RosterSlot_userId_gameSeason_cardId_key" ON "RosterSlot"("userId", "gameSeason", "cardId");
CREATE INDEX IF NOT EXISTS "RosterSlot_userId_gameSeason_idx" ON "RosterSlot"("userId", "gameSeason");
