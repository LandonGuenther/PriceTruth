# ADR-007: Observation archive format (parquet + manifests)

## Context

`PriceObservation` is append-only and will grow unboundedly. We need a durable,
tool-neutral export for backup, offline analysis, and eventual restore
verification — without touching Postgres contents.

## Decision

- Parquet batches partitioned `schema=v1/retailer=<r>/year=…/month=…/day=…/part-<firstId>-<lastId>.parquet`
  by `receivedAt` UTC day, plus a sibling `.manifest.json` carrying rowCount,
  first/last observation id, receivedAt bounds, `sha256` of the file,
  schemaVersion, softwareVersion, destination.
- Written with `@dsnp/parquetjs` **1.8.9** — the pinned 1.9.3 tarball was
  published without `dist/` (9 metadata files, no code), so the newest usable
  release is 1.8.9. CJS package; imported via default import under our ESM
  setup.
- `ObservationArchive` interface (`putObject`/`getObject`/`exists`/`list`)
  with `LocalFilesystemArchive` now; `S3CompatibleArchive` is PLANNED.
- Incremental export via `JobCheckpoint "archive:observations"`; `ArchiveBatch`
  ledger table (`key` unique + sha256) makes reruns idempotent — equal sha256
  skips, mismatched sha256 throws, never overwrite.
- Columns: every immutable `PriceObservation` fact column + `retailerId` +
  `dataSourceKey` (BigInt→INT64, timestamps→TIMESTAMP_MILLIS, enums→UTF8).
  `status` (the only mutable column) is excluded — see ARCHIVE_FORMAT.md.

## Alternatives considered

- **ndjson.gz** — simplest, human-readable, but ~3–5× larger and no columnar
  scan/pruning; fine for a stopgap, weak as the long-term format.
- **hyparquet-writer (0.x)** — pure-TS, typed, actively maintained, but 0.x API
  stability risk and we already run the parquetjs API surface.
- **parquet-wasm** — fast, but adds a WASM toolchain + memory management to a
  batch CLI; unnecessary at this volume.
- **@dsnp/parquetjs (chosen)** — maintained fork of the classic library,
  supports read-back (needed for restore verification) in the same dependency.

## Consequences

Deterministic, verifiable, tool-agnostic archive. Known limitation: partition
keys embed batch boundaries, so a re-export with different data between
checkpoints produces additional files rather than replacing them — never an
overwrite.

## Future migration trigger

When a second environment needs shared access (or local disk is not durable
enough), implement `S3CompatibleArchive` (env vars in ARCHIVE_FORMAT.md). A
column change → bump `schema=v2/` prefix and `ARCHIVE_SCHEMA_VERSION`; old
partitions remain readable by construction.
