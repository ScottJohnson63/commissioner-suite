-- Card customization: an owner-given nickname and portrait, plus the marker
-- that pays the reward once per card.
--
-- Additive and idempotent. SQLite has no ADD COLUMN IF NOT EXISTS, so the
-- applier tolerates "duplicate column name" — see prisma/apply-customization.ts.
ALTER TABLE "CardOwnership" ADD COLUMN "nickname" TEXT;
ALTER TABLE "CardOwnership" ADD COLUMN "customImage" TEXT;
ALTER TABLE "CardOwnership" ADD COLUMN "rewardedAt" DATETIME;
