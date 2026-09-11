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

## Idempotency and integrity

Export progress is `JobCheckpoint "archive:observations"` (last exported id).
Every written batch is recorded in `ArchiveBatch` (`key` unique, first/last id,
rowCount, sha256). Write order per batch: `.parquet` object → `.manifest.json`
→ `ArchiveBatch` ledger row → checkpoint. Re-exporting a key whose stored
sha256 matches the freshly computed bytes is skipped.

Crash-recovery rules (object store and ledger may diverge mid-batch):

- Ledger row present, sha256 equal → skip.
- Ledger row present, sha256 different → throw (never overwrite).
- No ledger row, object present, bytes equal → backfill the ledger row and
  continue.
- No ledger row, object present, bytes different → `ArchiveIntegrityError`.

Parquet bytes are deterministic for a fixed row set (covered by a test).

## Destinations

`ARCHIVE_BACKEND=local` (default) → `LocalFilesystemArchive` rooted at
`ARCHIVE_LOCAL_DIR` (or `--dir`). `ARCHIVE_BACKEND=s3` →
`S3CompatibleArchive` (`src/archive/s3.ts`) for S3 / Cloudflare R2 / MinIO;
requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` (plus `S3_REGION` default `auto`, `S3_FORCE_PATH_STYLE`,
`S3_REQUEST_TIMEOUT_MS`).

S3 writes carry `IfNoneMatch: "*"` + `ChecksumSHA256`; a `412` is resolved by
re-reading and comparing bytes (equal → idempotent success, different →
`ArchiveIntegrityError`). Retries are SDK-level (maxAttempts 4, adaptive).
Objects are batch-sized (≤50k rows), far under the 5 GiB single-PUT limit.

## CLI

```sh
pnpm --filter @pricetruth/api jobs archive [--dir /path] [--max-batches N] [--dry-run]
```

`--dir` applies to the local backend only. `--dry-run` computes keys/sha/counts
without writing objects, ledger rows, or the checkpoint.

## Restore / verification procedure

1. Locate the batch: `ArchiveBatch` table or the manifest.
2. Recompute `sha256` of the `.parquet` object and compare to the manifest —
   mismatch means corruption, do not use the file.
3. Read with any parquet reader (`ParquetReader.openBuffer` in
   `@dsnp/parquetjs`, DuckDB, pandas). Row count must equal
   `manifest.rowCount`.
4. Field-level round-trip is covered by the restore test in
   `apps/api/test/api.test.ts` (export → sha256 → read-back → field equality →
   rerun writes nothing); crash-recovery semantics are covered by
   `apps/api/test/jobs.test.ts`.
