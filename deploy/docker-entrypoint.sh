#!/bin/sh
set -eu

echo "[entrypoint] cwd=$(pwd) node=$(node -v)"
echo "[entrypoint] prisma schema=$(test -f prisma/schema.prisma && echo ok || echo MISSING)"
echo "[entrypoint] migrations=$(test -d prisma/migrations && ls prisma/migrations | wc -l || echo 0) dirs"
echo "[entrypoint] migration_lock=$(test -f prisma/migrations/migration_lock.toml && echo ok || echo MISSING)"
echo "[entrypoint] DATABASE_URL set=$(test -n "${DATABASE_URL:-}" && echo yes || echo NO)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL is required for prisma migrate deploy" >&2
  exit 1
fi

if [ ! -f prisma/migrations/migration_lock.toml ]; then
  echo "[entrypoint] prisma/migrations/migration_lock.toml missing — migrations cannot run" >&2
  exit 1
fi

echo "[entrypoint] waiting for database + applying migrations..."
# Prisma migrate deploy is idempotent; retries cover slow Postgres first boot.
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[entrypoint] migrate deploy failed after $i attempts" >&2
    exit 1
  fi
  echo "[entrypoint] migrate not ready (attempt $i), sleep 2s..."
  sleep 2
done

echo "[entrypoint] migrations applied; starting API on :${PORT:-5500}"
exec node dist/src/main.js
