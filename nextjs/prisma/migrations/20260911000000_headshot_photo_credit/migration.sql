-- Attribution for the Wikimedia Commons portraits.
--
-- sync_player_headshots.py falls back to a player's Wikipedia article image for
-- anyone nfl.com and ESPN have no photograph of — the only source that reaches
-- pre-2009 players at all. Most of those files are CC BY-SA, which requires the
-- photographer and the licence to be credited wherever the image is shown, and
-- until now the only thing recorded was `source = 'WIKIPEDIA'`. That is enough
-- to know a credit is owed and not enough to print one.
--
-- Four nullable columns on each side, because the credit has to survive the
-- trip to the card:
--
--   * NflPlayerHeadshot is where the sync script writes what Commons states
--     about the file.
--   * CardDefinition is where the pool builder copies it, beside the `headshot`
--     URL it already copies, so a card carries its own credit and the read path
--     gains no join. See resolvedHeadshots in src/lib/cards/pool.ts.
--
-- Null everywhere on the NFL and ESPN portraits, which carry no attribution
-- requirement, and on team defenses, which have no portrait at all.
--
-- Additive: SQLite's ALTER TABLE ADD COLUMN rewrites no rows, and nothing
-- existing is read, altered or dropped. Not re-runnable, though — SQLite has no
-- ADD COLUMN IF NOT EXISTS, so a second run stops on "duplicate column name"
-- having changed nothing.

ALTER TABLE "NflPlayerHeadshot" ADD COLUMN "author" TEXT;
ALTER TABLE "NflPlayerHeadshot" ADD COLUMN "license" TEXT;
ALTER TABLE "NflPlayerHeadshot" ADD COLUMN "licenseUrl" TEXT;
ALTER TABLE "NflPlayerHeadshot" ADD COLUMN "fileUrl" TEXT;

ALTER TABLE "CardDefinition" ADD COLUMN "photoAuthor" TEXT;
ALTER TABLE "CardDefinition" ADD COLUMN "photoLicense" TEXT;
ALTER TABLE "CardDefinition" ADD COLUMN "photoLicenseUrl" TEXT;
ALTER TABLE "CardDefinition" ADD COLUMN "photoFileUrl" TEXT;
