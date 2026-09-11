# Data Platform (M4)

## Repository boundary

`apps/api/src/repositories/priceHistoryRepository.ts` — `PriceHistoryRepository`
is the only interface routes/services use to read observations:

- `getCurrentObservation(listingId)` — newest eligible row
- `getHistory(listingId, { since })` — eligible rows, ascending `effectiveAt`
- `getDailyHistory(listingId, { since })` — daily-median series
- `getAnalysisInput(listingId)` — scoring observations + currency + evidence summary

`PostgresPriceHistoryRepository` implements it over Prisma. `findListing` in
analysisService keeps listing lookup only; `/v1/listings/*/analysis` and
`/history` responses are unchanged.

Eligibility comes from `packages/scoring/src/eligibility.ts` (see
docs/DATA_QUALITY.md) — the repository applies `ELIGIBLE_STATUSES` /
`ELIGIBLE_PRICE_TYPES` verbatim.

## Daily rollup

`ListingDailyPrice` is a deterministic per-listing, per-UTC-day rollup of
eligible rows: observation count, low/high/median, first/last (by
`effectiveAt`, then id), `referenceMedianCents` (median of non-null
reference prices, null if none), `sourceCount` (distinct `dataSourceId`),
`aggregationVersion`, `computedAt`. Keyed `@@unique([listingId, day])`.

`runDailyRollupJob` (`apps/api/src/jobs/dailyRollup.ts`) is incremental and
restartable via two `JobCheckpoint` cursors:

- `rollup:observations` — new `PriceObservation.id`s
- `rollup:status-events` — new `ObservationStatusEvent.id`s, so a status flip
  (e.g. QUARANTINED→CORROBORATED) re-rolls the affected day

Each batch collects distinct (listingId, day) pairs and recomputes them in ONE
set-based statement (`unnest` pairs → aggregate → `INSERT … ON CONFLICT` →
delete emptied days), upserts, and advances both cursors — all in one
transaction, so a crash at any point resumes cleanly. A day whose eligible set
becomes empty has its rollup row deleted. Measured ~8,700 listing-days/s at 5M
observations (see `docs/PERFORMANCE_BASELINE.md`); a single-warehouse analytics
store is a FUTURE option (`docs/adr/ADR-future-clickhouse.md`).

CLI: `pnpm --filter @pricetruth/api jobs rollup [--batch-size 5000]`.

## IMPLEMENTED vs PLANNED

IMPLEMENTED: repository boundary; on-demand `getDailyHistory` (raw rows →
`collapseToDailySeries`); rollup table, job, cursors, CLI.

PLANNED: `getDailyHistory`/`getAnalysisInput` reading `ListingDailyPrice`
instead of raw rows. Trigger: history scan cost on long-lived listings (see
SCALE_TRIGGERS). Consumers must not depend on the rollup table until that
switch — it is a cache, not a source of truth.
