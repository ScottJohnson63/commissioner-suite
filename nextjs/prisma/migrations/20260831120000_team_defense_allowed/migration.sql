-- Team-defense scoring needs two figures nflverse does not publish per player:
-- the points and the offensive yards a defense conceded. Both are properties of
-- the game rather than of any one player, which is why they have no column yet.
--
-- They live on NflWeeklyStat alongside the DEF rows the defense sync writes
-- (playerId = the team abbreviation, matching Sleeper's own DEF player ids), so
-- a defense reads through exactly the same window and cross-reference as a
-- running back rather than needing a parallel path.
--
-- Additive and nullable: every existing row keeps NULL, which the scoring code
-- reads as "no game on record" rather than as a shutout.
ALTER TABLE "NflWeeklyStat" ADD COLUMN "pointsAllowed" REAL;
ALTER TABLE "NflWeeklyStat" ADD COLUMN "yardsAllowed" REAL;
