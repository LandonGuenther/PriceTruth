# ADR-future: analytical store (ClickHouse or equivalent) for price history

Status: **FUTURE — not adopted.** Nothing in this ADR is implemented; it records the
conditions under which we would adopt an analytical database and the path we would take.

## Context

PostgreSQL is the single source of truth for `PriceObservation` and serves both
operational ingestion and all history/analysis reads. At the synthetic 5M-row baseline every
hot path is index-driven and sub-25 ms (`docs/PERFORMANCE_BASELINE.md`), and daily rollups
run set-based. There is no measured reason to add a second database today, and every
additional system adds operational surface, consistency questions and cost.

The risks that would eventually change that are analytical, not transactional:
cross-retailer scans, category-wide statistics, long-range per-listing history over years,
and rollup/archive jobs competing with ingestion for the operational database.

## Decision

Do **not** deploy ClickHouse (or any analytical store) now. Instead keep the escape path
cheap:

- all history reads go through `PriceHistoryRepository`
  (`getCurrentObservation`, `getHistory`, `getDailyHistory`, `getAnalysisInput`), whose
  only implementation is `PostgresPriceHistoryRepository`;
- `ListingDailyPrice` is a derived, rebuildable table with an `aggregationVersion`;
- the parquet archive (`docs/ARCHIVE_FORMAT.md`) is partitioned by retailer/day with
  manifests and is readable by ClickHouse (`file()`/S3 engines), DuckDB and Spark as-is.

## Triggers (any one, measured in production, sustained)

Mirrors `docs/SCALE_TRIGGERS.md`:

1. `PriceObservation` ≥ 100M rows or ≥ 250 GB including indexes (T1).
2. `history?days=180` or `analysis` p95 > 250 ms after daily rows are already in use (T2/T3).
3. Analytical jobs consume > 20% of operational DB CPU or degrade ingest p95 > 2× (T4).
4. Full daily rollup rebuild > 12 h (T5).
5. Any recurring cross-retailer/category query scanning > 10% of the fact table (T6).

## Likely migration path

1. **Read replica first.** Point jobs and long-range reads at a PostgreSQL replica. Cheapest
   step; may be sufficient for a long time.
2. **Analytical store fed from the archive.** Load parquet partitions into ClickHouse
   (`MergeTree` ordered by `(listingId, effectiveAt)`, partitioned by month; a
   `ReplacingMergeTree` keyed on observation `id` for idempotent reloads). Raw rows stay in
   PostgreSQL; ClickHouse holds a copy plus daily aggregates. Backfill = replay the
   archive; incremental = export new batches, then load.
3. **Second repository implementation.** `ClickHousePriceHistoryRepository` implementing
   the same interface; `getDailyHistory`/`getAnalysisInput` for long ranges route there,
   `getCurrentObservation` and the recent window stay on PostgreSQL. Scoring, API routes and
   the extension are untouched.
4. **Status/eligibility.** Because `status` is mutable and excluded from the archive, the
   analytical copy must join `ObservationStatusEvent` (archiving of status events is
   PLANNED) or receive status updates as a separate stream. Until then, the analytical
   store may only be used for statistics where quarantine lag is acceptable, never for the
   consumer-facing Deal Score.

## Alternatives considered

- **TimescaleDB** — keeps one system, hypertables + continuous aggregates; strongest
  candidate if the trigger is rollup cost rather than cross-retailer scans. Would be
  evaluated alongside ClickHouse at trigger time.
- **Partitioning PostgreSQL by month** — no new system; addresses T5/T8 but not analytical
  scans. Likely done before either of the above.
- **DuckDB over the archive** — zero-infrastructure ad-hoc analytics on parquet; good for
  internal analysis now, not a serving store.

## Consequences

- Today: no extra infrastructure; the repository boundary and archive format carry a small
  discipline cost (keep reads behind the interface, keep parquet columns stable).
- At trigger time: a second copy of the fact table, an ingest pipeline from archive to
  analytical store, and a consistency story for mutable status.
