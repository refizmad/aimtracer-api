#!/bin/sh
# Nightly Postgres dump. Mounted into the backup profile service.
# Local file always written to /backups/. Optional S3 upload when aws CLI
# is available and S3_* are set (install awscli in a custom image if needed).
set -eu

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/backups/aimtrace-${STAMP}.sql.gz"

echo "[backup] dumping to ${FILE}"
pg_dump -h db -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" | gzip -c > "${FILE}"
ls -la "${FILE}"

# Keep last 14 local dumps
ls -1t /backups/aimtrace-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

# Optional upload: requires `aws` in PATH (not in the stock postgres image).
# Prefer host cron: docker compose run --rm backup, then aws s3 cp from host.
if command -v aws >/dev/null 2>&1 && [ -n "${S3_ENDPOINT_URL:-}" ] && [ -n "${S3_BUCKET:-}" ]; then
  KEY="${S3_BACKUP_PREFIX:-backups/postgres}/aimtrace-${STAMP}.sql.gz"
  echo "[backup] uploading s3://${S3_BUCKET}/${KEY}"
  AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID}" \
  AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY}" \
  aws --endpoint-url "${S3_ENDPOINT_URL}" --region "${S3_REGION:-us-east-1}" \
    s3 cp "${FILE}" "s3://${S3_BUCKET}/${KEY}"
else
  echo "[backup] skipped S3 upload (install awscli + set S3_* or copy /backups from host cron)"
fi

echo "[backup] done"
