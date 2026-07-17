-- AlterTable
ALTER TABLE "clips" ADD COLUMN     "match_date" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "clips_match_date_created_at_idx" ON "clips"("match_date", "created_at");

-- Backfill: existing clips inherit their match's date so the gallery's
-- "Newest" (match-date) ordering is correct for history, not only new rows.
UPDATE "clips" c
SET "match_date" = m."match_date"
FROM "matches" m
WHERE c."match_id" = m."id" AND c."match_date" IS NULL;
