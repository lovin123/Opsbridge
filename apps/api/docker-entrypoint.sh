#!/bin/sh
set -eu

cd /app/apps/api

echo "[api] Running prisma migrate deploy…"
set +e
deploy_out="$(pnpm exec prisma migrate deploy 2>&1)"
deploy_status=$?
set -e
printf '%s\n' "$deploy_out"

if [ "$deploy_status" -ne 0 ]; then
  # P3005: DB already has tables but _prisma_migrations is missing/empty
  # (common when the managed DB was created via local migrate/db push/seed).
  if printf '%s' "$deploy_out" | grep -q 'P3005'; then
    echo "[api] Database is not empty and has no migration history — baselining existing migrations…"
    for dir in prisma/migrations/*/; do
      [ -d "$dir" ] || continue
      name="$(basename "$dir")"
      case "$name" in
        .*|migration_lock.toml) continue ;;
      esac
      echo "[api] Marking applied: $name"
      pnpm exec prisma migrate resolve --applied "$name"
    done
    echo "[api] Re-running prisma migrate deploy…"
    pnpm exec prisma migrate deploy
  else
    echo "[api] prisma migrate deploy failed"
    exit "$deploy_status"
  fi
fi

echo "[api] Starting Nest…"
exec pnpm start:prod
