#!/usr/bin/env bash
# Verifies a pg_dump of the dev database can be restored into a scratch DB.
# Requires pg_dump/pg_restore/psql. When only docker is available, run via:
#   docker compose exec -T db bash /scripts/backup-verify.sh   (mount scripts/)
# or set USE_DOCKER=1 to run the pg tools inside the db container.
set -euo pipefail

SRC_DB="${SRC_DB:-pricetruth}"
VERIFY_DB="${VERIFY_DB:-pricetruth_backup_verify}"
PGUSER="${PGUSER:-pricetruth}"
PGHOST="${PGHOST:-localhost}"

if [[ "${USE_DOCKER:-0}" == "1" ]]; then
  PSH() { docker compose exec -T db psql -U "$PGUSER" "$@"; }
  DUMP() { docker compose exec -T db pg_dump -U "$PGUSER" "$@"; }
  REST() { docker compose exec -T db pg_restore -U "$PGUSER" "$@"; }
else
  PSH() { psql -h "$PGHOST" -U "$PGUSER" "$@"; }
  DUMP() { pg_dump -h "$PGHOST" -U "$PGUSER" "$@"; }
  REST() { pg_restore -h "$PGHOST" -U "$PGUSER" "$@"; }
fi

DUMP_FILE="$(mktemp -t pricetruth-backup-XXXXXX.dump)"
trap 'rm -f "$DUMP_FILE"; PSH -d postgres -c "DROP DATABASE IF EXISTS $VERIFY_DB" >/dev/null 2>&1 || true' EXIT

echo "== dump $SRC_DB =="
DUMP -d "$SRC_DB" -Fc -f "$DUMP_FILE"
ls -la "$DUMP_FILE"

echo "== restore into $VERIFY_DB =="
PSH -d postgres -c "DROP DATABASE IF EXISTS $VERIFY_DB"
PSH -d postgres -c "CREATE DATABASE $VERIFY_DB"
REST -d "$VERIFY_DB" --no-owner --no-privileges "$DUMP_FILE"

echo "== sanity counts =="
PSH -d "$VERIFY_DB" -c '
  SELECT count(*) AS observations FROM "PriceObservation";
  SELECT count(*) AS listings FROM "Listing";
  SELECT count(*) AS migrations FROM "_prisma_migrations";'

echo "OK: backup restored and readable."
