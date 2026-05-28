-- Add homePoints and awayPoints to Matchup for tracking actual scores
ALTER TABLE "Matchup" ADD COLUMN "homePoints" REAL;
ALTER TABLE "Matchup" ADD COLUMN "awayPoints" REAL;
