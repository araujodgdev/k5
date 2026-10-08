#!/usr/bin/env bash
set -euo pipefail
umask 077

# pg_dump receives connection fields through the environment, never the process command line.
: "${DATABASE_URL_UNPOOLED:?Configure DATABASE_URL_UNPOOLED for backups.}"
: "${K5_BACKUP_AGE_RECIPIENT:?Configure the public age recipient for backups.}"
command -v pg_dump >/dev/null
command -v age >/dev/null
command -v node >/dev/null

backup_dir=${K5_BACKUP_DIR:-.data/backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_partial=$(mktemp "$backup_dir/.backup.XXXXXXXX")
backup_errors=$(mktemp "$backup_dir/.errors.XXXXXXXX")
trap 'rm -f -- "$backup_partial" "$backup_errors"' EXIT

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if ! node "$script_dir/backup-database.mjs" 2>"$backup_errors" |
  age --recipient "$K5_BACKUP_AGE_RECIPIENT" 2>>"$backup_errors" >"$backup_partial"; then
  # Driver stderr can contain hostnames and credentials. Keep it out of Actions logs.
  echo 'Database backup failed. Check database access, pg_dump version and age recipient.' >&2
  exit 1
fi
test -s "$backup_partial"
backup_name="lume-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
mv -- "$backup_partial" "$backup_dir/$backup_name"
(cd "$backup_dir" && sha256sum "$backup_name" >"$backup_name.sha256")
echo 'Encrypted database backup completed.'
