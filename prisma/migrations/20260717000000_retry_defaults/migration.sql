-- Retry policy: a job gets 3 attempts total before it is flagged FAILED.
ALTER TABLE "jobs" ALTER COLUMN "maxAttempts" SET DEFAULT 3;

-- Bring queued/in-flight jobs onto the new policy (terminal jobs untouched).
UPDATE "jobs" SET "maxAttempts" = 3
WHERE "maxAttempts" > 3 AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');
