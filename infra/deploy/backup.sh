#!/bin/sh
set -eu
cd /opt/procurex/current
umask 077
mkdir -p /opt/procurex/backups
file="/opt/procurex/backups/database-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file /opt/procurex/shared/compose.env -f infra/deploy/compose.yaml exec -T postgres pg_dump -U procurex -d procurex -Fc > "$file.tmp"
mv "$file.tmp" "$file"
files="${file%.dump}-files.tar.gz"
tar -czf "$files.tmp" -C /opt/procurex/shared private-files
mv "$files.tmp" "$files"
find /opt/procurex/backups -name 'database-*.dump' -mtime +14 -delete
find /opt/procurex/backups -name 'database-*-files.tar.gz' -mtime +14 -delete
