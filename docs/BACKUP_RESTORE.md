# Backup & restore

Status: IMPLEMENTED (verify script + procedure; scheduled backups are FUTURE)

## Backup

```sh
pg_dump -U pricetruth -d pricetruth -Fc -f pricetruth-$(date +%Y%m%d).dump
# or inside the container:
docker compose exec -T db pg_dump -U pricetruth -d pricetruth -Fc > backup.dump
```

## Restore

```sh
createdb -U pricetruth pricetruth_restore
pg_restore -U pricetruth -d pricetruth_restore --no-owner --no-privileges backup.dump
```

## Verify — `scripts/backup-verify.sh`

Dumps the dev DB (custom format), restores into `pricetruth_backup_verify`,
runs sanity counts, drops the scratch DB. Requires `pg_dump`/`pg_restore`/
`psql`, or `USE_DOCKER=1` to run the tools inside the `db` container.

Verified on this repo (dev DB — 1 observation / 1 listing at the time; 8
`_prisma_migrations` rows restored):

```
== dump pricetruth ==        (custom-format dump written)
== restore into pricetruth_backup_verify ==
== sanity counts ==          observations 1, listings 1, migrations 8
OK: backup restored and readable.
```

(Full transcript: the script was run with `USE_DOCKER=1` against the compose
`db` service on 2026-09-11.)

## Retention / scheduling

FUTURE — when a real deployment exists, schedule dumps (e.g. daily, retained
30 days) and store them alongside the parquet archive bucket, not on the DB
volume.
