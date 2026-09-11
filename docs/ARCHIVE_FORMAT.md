# Observation Archive Format (M5)

Postgres remains the source of truth — the archive is an export copy for
durability and offline analysis. Nothing is ever deleted from Postgres by the
exporter.

## Layout

Objects are partitioned by `receivedAt` UTC day and retailer:

```
schema=v1/retailer=<retailerId>/year=YYYY/month=MM/day=DD/part-<firstId>-<lastId>.parquet
schema=v1/retailer=<retailerId>/year=YYYY/month=MM/day=DD/part-<firstId>-<lastId>.manifest.json
```

`<firstId>`/`<lastId>` are the first and last `PriceObservation.id` in the
partition. Each batch's manifest is a sibling `.manifest.json`.

## Manifest fields

```json
{
  "schemaVersion": 1,
  "rowCount": 5,
  "firstObservationId": "101",
  "lastObservationId": "105",
  "minReceivedAt": "2026-09-09T12:00:00.000Z",
  "maxReceivedAt": "2026-09-09T16:00:00.000Z",
  "createdAt": "<export time, ISO>",
  "softwareVersion": "pricetruth-archive@1.0.0",
  "sha256": "<sha256 of the .parquet file>",
  "destination": "<destination label, e.g. the --dir path>"
}
```

## Parquet schema (v1)

All `PriceObservation` columns plus `retailerId` (joined from Listing) and
`dataSourceKey` (joined from DataSource):

- `id` INT64 (BigInt preserved)
- `receivedAt`, `clientObservedAt`, `effectiveAt` TIMESTAMP_MILLIS (nullable
  where the column is)
- `priceType`, `referenceType`, `currency`, ids, `clientVersion`,
  `extractorVersion`, `retailerId`, `dataSourceKey` — UTF8
- `status` is NOT exported by design: it is the only mutable column, so a
  status flip would change a re-export's sha256 and trip the refuse-to-
  overwrite guard. Archiving `ObservationStatusEvent` (the status audit log)
  is PLANNED as a separate `schema=v1/status_events/` partition family.
- `priceCents`, `referencePriceCents`, `clientSkewSeconds`, `schemaVersion` —
  INT32; `inStock`, `synthetic` — BOOLEAN

## Idempotency

Export progress is `JobCheckpoint "archive:observations"` (last exported id).
Every written batch is recorded in `ArchiveBatch` (`key` unique, first/last id,
rowCount, sha256). Re-exporting a key whose stored sha256 matches the freshly
computed bytes is skipped; a mismatched sha256 throws — existing objects are
never overwritten.

## CLI

```sh
pnpm --filter @pricetruth/api jobs archive --dir /path/to/archive [--max-batches N]
```

`--dir` defaults to `ARCHIVE_LOCAL_DIR` (default `./archive`).

## Destinations

IMPLEMENTED: `LocalFilesystemArchive` (any directory; used by the CLI).
PLANNED: `S3CompatibleArchive` against the same `ObservationArchive`
interface — env vars `ARCHIVE_S3_ENDPOINT`, `ARCHIVE_S3_BUCKET`,
`ARCHIVE_S3_ACCESS_KEY_ID`, `ARCHIVE_S3_SECRET_ACCESS_KEY`, `ARCHIVE_S3_REGION`
(names reserved; not implemented).

## Restore / verification procedure

1. Locate the batch: `ArchiveBatch` table or the manifest.
2. Recompute `sha256` of the `.parquet` object and compare to the manifest —
   mismatch means corruption, do not use the file.
3. Read with any parquet reader (`ParquetReader.openBuffer` in
   `@dsnp/parquetjs`, DuckDB, pandas). Row count must equal
   `manifest.rowCount`.
4. Field-level round-trip is covered by the restore test in
   `apps/api/test/api.test.ts` (export → sha256 → read-back → field equality →
   rerun writes nothing).
