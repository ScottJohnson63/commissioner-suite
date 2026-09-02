CREATE TABLE IF NOT EXISTS "CardImage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "gameSeason" INTEGER NOT NULL,
  "cardId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CardImage_gameSeason_cardId_key" ON "CardImage"("gameSeason", "cardId");
CREATE INDEX IF NOT EXISTS "CardImage_userId_gameSeason_idx" ON "CardImage"("userId", "gameSeason");
ALTER TABLE "CardOwnership" DROP COLUMN "customImage";
