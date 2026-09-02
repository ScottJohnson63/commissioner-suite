CREATE TABLE IF NOT EXISTS "CardPortrait" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "contributedBy" TEXT NOT NULL,
  "contributedSeason" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CardPortrait_cardId_key" ON "CardPortrait"("cardId");
CREATE INDEX IF NOT EXISTS "CardPortrait_contributedBy_contributedSeason_idx" ON "CardPortrait"("contributedBy", "contributedSeason");
ALTER TABLE "CardOwnership" DROP COLUMN "rewardedAt";
