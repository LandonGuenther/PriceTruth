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

## Neon staging (PITR) — verified 2026-09-18

Restore was verified end-to-end on the live staging project: created a Neon
point-in-time branch `restore-verify-20260918` at
`parent_timestamp=2026-09-17T23:57:17Z`, queried it (13 observations, 11
listings, 8 `_prisma_migrations` rows, PG 16.15, 8.5 MB) matching live, then
deleted the branch. Cost $0.

**Caveat:** the Neon free plan caps `history_retention` at 6 h (21600 s) — the
PITR window is **6 hours**, not days. Recovery older than 6 h relies on the
parquet observation archive (replay path FUTURE).

## Retention / scheduling

FUTURE — schedule dumps (e.g. daily, retained 30 days) and store them
alongside the parquet archive, not on the DB volume. Neon free-plan PITR (6 h)
covers only very recent mistakes; scheduled `pg_dump` remains the durable
answer.
