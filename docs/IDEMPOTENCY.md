# Idempotency

## Retries of POST /v1/observations are safe

The server deduplicates: a second observation for the same listing with the
same price/reference/currency/dataSource within `±DEDUP_WINDOW` (60 min) of
`effectiveAt` returns **200** with `duplicate: true` and the existing
`observationId` — no new row is written. Client retries (timeouts, 5xx, 429)
therefore never double-count. The same price observed the next day is a new
row — that is new evidence, not a duplicate.

All other endpoints are read-only (`GET`), health/readiness are side-effect
free.

## `Idempotency-Key` header

**Accepted but not stored.** If a client sends `Idempotency-Key` on
`POST /v1/observations` the server logs it (request log only). Semantic dedup
above already makes retries safe; persisting keys for cross-retry replay is
FUTURE work if a stricter guarantee is ever needed.

## Batch jobs

Rollup and archive jobs are idempotent by construction — see
docs/DATA_PLATFORM.md (leases, `JobRun`) and docs/ARCHIVE_FORMAT.md
(sha256-verified object keys, `ArchiveBatch` ledger, checkpoint resume).
