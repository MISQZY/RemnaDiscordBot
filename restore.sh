#!/usr/bin/env bash
set -euo pipefail

# Restores a snapshot of backup.sh (or deploy.sh's backups/pre-deploy.dump) into the compose postgres:
#   bash restore.sh backups/db-20261019-041500.dump
# The app is stopped meanwhile and started again on the current images; the current data is replaced.

cd "$(dirname "$0")"
dump="${1:?usage: restore.sh <dump file>}"
[ -f "$dump" ] || { echo "No such file: $dump" >&2; exit 1; }
APP_SERVICES="bot worker api"

docker compose exec -T postgres pg_restore --list < "$dump" > /dev/null
read -r -p "Replace the database with $dump? [y/N] " answer
[ "$answer" = "y" ] || exit 1

docker compose stop $APP_SERVICES
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction' < "$dump"
# The dump may predate the latest migrations: apply them before the app starts.
docker compose run --rm --no-deps migrate
docker compose up -d --no-build --no-deps --wait $APP_SERVICES
echo "✅ Restored $dump"
