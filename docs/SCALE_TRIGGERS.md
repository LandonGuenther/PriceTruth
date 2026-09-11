# Scale triggers

Measurable conditions that should cause a specific architectural change. Until a trigger
fires, the corresponding change is **FUTURE** and must not be built. Each trigger names the
measurement, the threshold, and the escape path that already exists in the codebase.

Current status (2026-09-11, synthetic 5M-row baseline, see `docs/PERFORMANCE_BASELINE.md`):
none of the triggers below has fired.

| #   | Trigger (measure)                                      | Threshold                                                                                                       | Response                                                                                             | Escape path already in place                                       |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| T1  | `PriceObservation` row count                           | ≥ 100M rows, or table+indexes ≥ 250 GB                                                                          | Evaluate ClickHouse / columnar store for history and analytics (`docs/adr/ADR-future-clickhouse.md`) | `PriceHistoryRepository` boundary; parquet archive with manifests  |
| T2  | `GET …/history?days=180` p95 (production, per-listing) | > 250 ms sustained for a week                                                                                   | Serve ranges > 90 days from `ListingDailyPrice` instead of raw rows                                  | `ListingDailyPrice` + `runDailyRollupJob`; `getDailyHistory` seam  |
| T3  | `GET …/analysis` p95                                   | > 250 ms, or median eligible rows per listing > 5,000                                                           | Feed scoring from daily rows for the long-range statistics; keep raw rows for the recent window      | same as T2; `getAnalysisInput` seam                                |
| T4  | Analytical load on the operational database            | Rollup/archive/cross-retailer jobs > 20% of DB CPU, or p95 of `POST /v1/observations` degrades > 2× during jobs | Move jobs to a read replica; then to the analytical store (T1)                                       | Jobs are checkpointed, batchable, and read only by `id` cursors    |
| T5  | Daily rollup incremental run time                      | > 30 min per day, or full rebuild > 12 h                                                                        | Partition `PriceObservation` by month of `effectiveAt`; parallelise rollup by listing hash           | Set-based rollup, `JobCheckpoint` cursors                          |
| T6  | Cross-retailer analytical scans                        | Any recurring query that scans > 10% of `PriceObservation` (e.g. category-wide statistics)                      | Build those in the analytical store, never on the operational DB                                     | Archive parquet partitions are readable by DuckDB/ClickHouse today |
| T7  | API-path ingest                                        | Sustained > 50 observations/s, or p95 > 500 ms                                                                  | Batch assertion upserts, move corroboration to the job runner, then queue ingestion                  | Corroboration is idempotent and already job-shaped                 |
| T8  | Index write amplification                              | `(listingId, effectiveAt)` index > 50% of table size or bulk load < 5k rows/s                                   | Re-evaluate index set with plans; consider BRIN on `receivedAt`                                      | Index review procedure in `PERFORMANCE_BASELINE.md`                |
| T9  | Catalog                                                | > 1M `Product` rows or identity lookup p95 > 20 ms                                                              | Add `IdentifierAssertion` covering index, review `ProductIdentifier` value encoding                  | Match engine is pure; storage is one table                         |
| T10 | Archive                                                | Local filesystem archive > 100 GB, or need for off-VM durability                                                | Implement `S3CompatibleArchive` (R2/S3) behind the existing interface                                | `ObservationArchive` interface, manifests, idempotent export       |

How to measure: the bench scripts (`pnpm --filter @pricetruth/api bench`) reproduce T1–T3,
T5, T8, T9 on a disposable database; production values should come from API request
logging (not yet instrumented — PLANNED).
