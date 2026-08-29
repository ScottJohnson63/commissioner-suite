-- Widens NflWeeklyStat to every column nflverse publishes.
--
-- load_player_stats returns 150 columns; this table stored 53. The missing 97
-- are whole categories, not stragglers: defense, kicking, punting, returns,
-- fumbles, penalties, and the yardage-bucket breakdowns. All 97 are non-null
-- for every row of the 2025 season, and 96 of them carry non-zero values, so
-- these are real stats rather than placeholders.
--
-- Note this partly reverses 20260823000000_prune_schema_add_sync_run, which
-- dropped columns like sackYardsLost as "unnecessary". They are back because
-- the goal changed: full coverage of what nflverse offers.
--
-- ADD COLUMN is one of the few ALTERs SQLite supports outright — no table
-- rebuild, so the existing 56,979 rows are untouched and simply read NULL for
-- the new columns until the next sync backfills them.

ALTER TABLE "NflWeeklyStat" ADD COLUMN "gameId" TEXT;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "sackYardsLost" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "sackFumbles" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "sackFumblesLost" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "passing2ptConversions" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "passing10" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "passing16" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "passing20" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "passing40" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushingFumbles" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushingFumblesLost" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushing2ptConversions" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushing10" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushing12" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushing20" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "rushing40" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receivingFumbles" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receivingFumblesLost" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receiving2ptConversions" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receiving10" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receiving16" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receiving20" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "receiving40" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defTacklesWithAssist" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defTackleAssists" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defTacklesForLossYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defSackYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defInterceptionYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defFumbles" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defSafeties" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defPuntBlocks" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defPatBlocks" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "defFgBlocks" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "def2ptAtts" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "def2ptMade" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgBlocked" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgLong" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgPct" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade0To19" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade20To29" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade30To39" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade40To49" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade50To59" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMade60Plus" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed0To19" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed20To29" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed30To39" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed40To49" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed50To59" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissed60Plus" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMadeList" TEXT;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissedList" TEXT;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgBlockedList" TEXT;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMadeDistance" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgMissedDistance" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fgBlockedDistance" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "patAtt" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "patMissed" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "patBlocked" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "patPct" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "gwfgMade" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "gwfgAtt" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "gwfgMissed" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "gwfgBlocked" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "gwfgDistance" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptAtt" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptBlocked" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptLong" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptInside20" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptOutOfBounds" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptDowned" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptTouchback" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptFairCaught" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptReturned" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptReturnYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptReturnTds" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "ptNetYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "specialTeamsTds" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "miscYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumbleRecoveryOwn" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumbleRecoveryYardsOwn" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumbleRecoveryOpp" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumbleRecoveryYardsOpp" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumbleRecoveryTds" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "penalties" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "penaltyYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumblesForcedByOpp" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumblesNotForced" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumblesOutOfBounds" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumblesTotal" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "fumblesLostTotal" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "puntReturns" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "puntReturnYards" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "kickoffReturns" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "kickoffReturnYards" REAL;
