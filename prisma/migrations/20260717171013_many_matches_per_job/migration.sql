-- DropIndex
DROP INDEX "matches_job_id_key";

-- CreateIndex
CREATE INDEX "matches_job_id_idx" ON "matches"("job_id");
