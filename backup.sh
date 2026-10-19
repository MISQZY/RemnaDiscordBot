#!/usr/bin/env bash
set -euo pipefail

# Daily database snapshot, run on the server from the repository clone, e.g. by cron:
#   15 4 * * * cd /opt/discord-bot && bash backup.sh >> backups/backup.log 2>&1
# pg_dump of the compose postgres into backups/ in the custom format (restore.sh restores it);
# only the newest BACKUP_KEEP snapshots (14 by default) are kept.
# With BACKUP_REMOTE set (an rclone remote, e.g. "b2:discord-bot-backups"), the snapshots are also copied
# off the server: a copy on the same disk does not survive losing the disk. The remote keeps the newest
# BACKUP_REMOTE_KEEP of them (30 by default).
# Redis is not dumped: it holds caches, sessions and cooldowns, persisted by its own AOF (redis-data volume).

cd "$(dirname "$0")"

# A variable of .env, read like docker compose reads it: a " #" starts a comment after the value.
env_value() {
  grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | sed "s/[[:space:]]#.*//; s/[[:space:]]*\$//" || true
}

BACKUP_REMOTE="${BACKUP_REMOTE:-$(env_value BACKUP_REMOTE)}"
KEEP=$(env_value BACKUP_KEEP)
KEEP=$(( ${KEEP:-14} > 0 ? ${KEEP:-14} : 1 ))
REMOTE_KEEP=$(env_value BACKUP_REMOTE_KEEP)
REMOTE_KEEP=$(( ${REMOTE_KEEP:-30} > 0 ? ${REMOTE_KEEP:-30} : 1 ))

# Snapshots are readable by their owner only: they hold every guild's data.
umask 077
mkdir -p backups
name="db-$(date -u +%Y%m%d-%H%M%S).dump"
# Renamed only once whole and readable, so a failure never leaves a broken snapshot among the good ones.
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
  > "backups/$name.partial"
docker compose exec -T postgres pg_restore --list < "backups/$name.partial" > /dev/null
mv "backups/$name.partial" "backups/$name"

ls backups | grep -E '^db-[0-9]{8}-[0-9]{6}\.dump$' | sort -r | tail -n +$((KEEP + 1)) | sed 's#^#backups/#' | xargs -r rm -f
echo "Backup backups/$name ($(du -h "backups/$name" | cut -f1)), $(ls backups | grep -cE '^db-.*\.dump$') kept"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy backups "$BACKUP_REMOTE" --include 'db-*.dump'
  # `rclone copy` never deletes: the oldest snapshots past REMOTE_KEEP go one by one.
  rclone lsf "$BACKUP_REMOTE" --include 'db-*.dump' | { grep -E '^db-[0-9]{8}-[0-9]{6}\.dump$' || true; } | sort -r |
    tail -n +$((REMOTE_KEEP + 1)) | while read -r old; do rclone deletefile "$BACKUP_REMOTE/$old"; done
  echo "Copied to $BACKUP_REMOTE ($REMOTE_KEEP kept there)"
fi
