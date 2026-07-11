#!/bin/sh
set -eu

echo "[entrypoint] waiting for database..."
# Prisma migrate deploy is idempotent; retries cover slow Postgres first boot.
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[entrypoint] migrate deploy failed after retries" >&2
    exit 1
  fi
  echo "[entrypoint] migrate not ready (attempt $i), sleep 2s..."
  sleep 2
done

echo "[entrypoint] migrations applied; starting API on :${PORT:-5500}"
exec node dist/src/main.js
