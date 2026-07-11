-- MatchShareCode evolves into Match (rename, so discovery/cursor rows and the
-- poller's dedup state survive), plus the new Clip table ingested from worker
-- results. Hand-written instead of prisma-generated: a generated diff would
-- DROP + CREATE on rename and lose the dev data.

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('DETECTED', 'DOWNLOADED', 'RENDERED', 'FAILED');

-- Rename table + align constraint/index names with Prisma's defaults for the
-- new model name (future `migrate diff` runs must see no drift).
ALTER TABLE "match_share_codes" RENAME TO "matches";
ALTER TABLE "matches" RENAME CONSTRAINT "match_share_codes_pkey" TO "matches_pkey";
ALTER TABLE "matches" RENAME CONSTRAINT "match_share_codes_player_id_fkey" TO "matches_player_id_fkey";
ALTER TABLE "matches" RENAME CONSTRAINT "match_share_codes_job_id_fkey" TO "matches_job_id_fkey";
ALTER INDEX "match_share_codes_job_id_key" RENAME TO "matches_job_id_key";
ALTER INDEX "match_share_codes_player_id_job_id_idx" RENAME TO "matches_player_id_job_id_idx";
ALTER INDEX "match_share_codes_player_id_share_code_key" RENAME TO "matches_player_id_share_code_key";

-- New Match columns
ALTER TABLE "matches"
  ADD COLUMN "status" "MatchStatus" NOT NULL DEFAULT 'DETECTED',
  ADD COLUMN "map" TEXT,
  ADD COLUMN "demo_name" TEXT,
  ADD COLUMN "match_date" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3);

-- Backfill: match date ~ discovery time; status from the linked job's state.
UPDATE "matches" SET "match_date" = "discovered_at", "updated_at" = "discovered_at";
UPDATE "matches" m
SET "status" = CASE j."status"
    WHEN 'COMPLETED' THEN 'RENDERED'::"MatchStatus"
    WHEN 'FAILED'    THEN 'FAILED'::"MatchStatus"
    ELSE 'DETECTED'::"MatchStatus"
  END
FROM "jobs" j
WHERE m."job_id" = j."id";

ALTER TABLE "matches" ALTER COLUMN "match_date" SET NOT NULL;
ALTER TABLE "matches" ALTER COLUMN "updated_at" SET NOT NULL;

-- CreateIndex
CREATE INDEX "matches_player_id_status_idx" ON "matches"("player_id", "status");

-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "player_id" TEXT,
    "match_id" TEXT,
    "job_id" TEXT,
    "file" TEXT NOT NULL,
    "url" TEXT,
    "size_bytes" INTEGER,
    "clip_type" TEXT,
    "map" TEXT,
    "round" INTEGER,
    "kills" INTEGER,
    "headshots" INTEGER,
    "score" INTEGER,
    "duration_s" DOUBLE PRECISION,
    "specials" JSONB,
    "clutch" JSONB,
    "kill_events" JSONB,
    "player_name" TEXT,
    "player_steamid" TEXT,
    "demo_name" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clips_file_key" ON "clips"("file");
CREATE INDEX "clips_player_id_created_at_idx" ON "clips"("player_id", "created_at");
CREATE INDEX "clips_match_id_idx" ON "clips"("match_id");
CREATE INDEX "clips_kills_idx" ON "clips"("kills");
CREATE INDEX "clips_clip_type_idx" ON "clips"("clip_type");

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clips" ADD CONSTRAINT "clips_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clips" ADD CONSTRAINT "clips_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
