-- Records whether an opened pack was a Sleeper bonus or one of the weekly ration.
--
-- The week's guaranteed Gold packs are a promise about the ration specifically:
-- "five packs, two of them Gold or better". A bonus pack rolls Silver-or-up and
-- will often be Gold, so without this column it would quietly satisfy a
-- guarantee it was never meant to count towards -- and a member who won a bonus
-- would end up with fewer guaranteed Gold ration packs than one who did not.
--
-- Existing rows default to false, which is correct: every pack opened before
-- bonus packs existed was a ration pack.

ALTER TABLE "PackOpening" ADD COLUMN "isBonus" BOOLEAN NOT NULL DEFAULT false;
