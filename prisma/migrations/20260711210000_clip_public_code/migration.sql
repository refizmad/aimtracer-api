-- Short public share codes for clips (UUID remains the primary key).
-- Column is added nullable, backfilled by the API on boot for any legacy rows
-- that somehow miss a code; new rows always set public_code at insert.

ALTER TABLE "clips" ADD COLUMN "public_code" TEXT;

-- Deterministic-ish backfill for existing rows (unique per id).
-- Prefer API random base58 codes for new clips; this only covers pre-migration data.
UPDATE "clips"
SET "public_code" = substr(
  translate(
    encode(sha256(convert_to(id, 'UTF8')), 'hex'),
    '01ilo',
    '23489'
  ),
  1,
  8
)
WHERE "public_code" IS NULL;

ALTER TABLE "clips" ALTER COLUMN "public_code" SET NOT NULL;

CREATE UNIQUE INDEX "clips_public_code_key" ON "clips"("public_code");
