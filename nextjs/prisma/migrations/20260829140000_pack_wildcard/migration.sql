-- Adds the weekly wildcard die to PackGrant.
--
-- A member gets a fixed ration of packs each week plus one roll of a six-sided
-- die, whose result is added to that ration as extra packs. The roll is stored
-- rather than recomputed so it is a fact rather than something that changes on
-- refresh; NULL means the die has not been thrown yet this week.
--
-- ADD COLUMN, so existing grants keep their ration and simply read NULL — every
-- member in progress gets their roll still to come.

ALTER TABLE "PackGrant" ADD COLUMN "wildcardRoll" INTEGER;
