# Overnight foundation sprint — report

Date: 2026-09-11. Branch `devin/pricetruth-foundation-overnight`, one PR against `main`
(URL at the end). Nothing was merged.

- **Starting commit:** `0ca7000` (merge of PR #1, Phase 2 data foundation)
- **Ending commit:** `b8bc321` + this follow-up (PR head)
- **Baseline before changes:** lint / typecheck / test / build green, **182 tests**
- **End state:** lint / typecheck / format / test / build green, **267 tests**
  (shared 17, catalog 16, scoring 39, retailer-adapters 89, extension 24, api 82)

## Work completed (by priority)

| P   | Milestone                                                                                                                                                                                                                                                                                                                                     | State    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| —   | `docs/OVERNIGHT_AUDIT.md` (architecture, strengths, blockers, hazards)                                                                                                                                                                                                                                                                        | done     |
| P0  | Data-model correctness — inherited from Phase 2 (BIGINT fact PK, native UUID dimensions, CHECK constraints, append-only triggers, client/server time, provenance, schema version); preserved and re-tested (fresh + upgrade migration paths)                                                                                                  | verified |
| P1  | Canonical identity: `ProductFamily`, `IdentifierAssertion`, `MatchEvidence`, `ProductLinkEvent`, `packages/catalog` (GTIN/UPC/EAN check digits, ASIN/MPN normalisation, match engine EXACT/HIGH/REVIEW/UNRESOLVED/CONFLICT), auto-link only on EXACT/HIGH, auditable CLI link/unlink                                                          | done     |
| P2  | Trust: `RECEIVED`/`CORROBORATED` states, `actor` on status events, anomaly quarantine (large move, cluster contradiction, oscillation, currency change) for client sources only, corroboration, one centralised eligibility policy, analysis `evidence` counts, validation hardening (hostnames, id formats, length caps, Int32, 64 KiB body) | done     |
| P3  | `PriceHistoryRepository` + `PostgresPriceHistoryRepository`; `ListingDailyPrice` deterministic/idempotent/restartable rollup with `JobCheckpoint`; parquet `ObservationArchive` (local FS) with partitions, manifests, sha256, idempotent ledger, restore test; `ADR-future-clickhouse`                                                       | done     |
| P4  | Load generator + bench (disposable `_load` DBs only), 100K / 1M / 5M runs, EXPLAIN plans, index review, rollup rewritten set-based (13×)                                                                                                                                                                                                      | done     |
| P5  | 32 adversarial API tests, bundle secret scan, `docs/SECURITY.md`, privacy doc update (no installation ID)                                                                                                                                                                                                                                     | done     |
| P6  | Amazon extraction: buy-box scoping, foreign-ASIN rejection, hidden-price → `no_price`, variant child-ASIN handling; 4 new fixtures                                                                                                                                                                                                            | done     |
| P7  | Docs: DATA_MODEL, DATA_PLATFORM, CATALOG_IDENTITY, DATA_QUALITY, ARCHIVE_FORMAT, PRIVACY, SECURITY, PERFORMANCE_BASELINE, SCALE_TRIGGERS, ADR-005/006/007/future-clickhouse, README, API, EXTENSION                                                                                                                                           | done     |

## Commits (oldest first)

```
766634f feat(catalog): canonical identity model, match engine, and auditable link corrections
b64d8b0 docs: overnight foundation audit
983e1c4 fix(catalog): only adopt valid identifiers into ProductIdentifier
f7eee42 feat(data-quality): trust states, anomaly quarantine, corroboration, and centralized eligibility
6e5a648 feat(history): PriceHistoryRepository boundary and deterministic ListingDailyPrice rollup
1a749ef feat(archive): parquet observation archive with manifests and restore verification
cd5c8cb fix(archive): archive immutable fact columns only
1db1aba perf(rollup): batch ranged read for listing-day pairs, extend txn timeout
68d5c13 feat(perf): synthetic load generator and benchmark scripts for disposable databases
5cea057 feat(perf): add --skip-rollup flag to bench
319c0df fix(bench): sequential timed requests, status assertions, per-request client address
0e1170c perf(rollup): set-based per-batch aggregation
aa8ebcc docs(perf): performance baseline, scale triggers, future ClickHouse ADR
6b00867 fix(amazon): scope price extraction to the buy box; never adopt cross-sell prices
c242a43 test(security): adversarial API tests
477d7f6 fix(amazon): treat all of the page's own ASINs as self when rejecting foreign prices
5e9a6fd docs(security): threat model, controls, findings
b05205e docs: overnight documentation sweep
52f20be chore: gitignore archive output dir
```

## Migrations added (all additive; no column dropped, no history rewritten)

```
20260911064203_catalog_identity                 ProductFamily, IdentifierAssertion, MatchEvidence,
                                                ProductLinkEvent, MANUFACTURER_MODEL, new enums
20260911064204_catalog_identity_model_backfill  backfill using the new enum value (separate txn)
20260911065530_observation_trust                RECEIVED/CORROBORATED, ObservationStatusEvent.actor
                                                (existing events backfilled actor='system:legacy')
20260911070434_daily_rollup                     ListingDailyPrice, JobCheckpoint
20260911070927_archive_batches                  ArchiveBatch ledger
```

Fresh-database path (`migrate deploy` on an empty DB, `migrate status` clean) and the
MVP-shaped upgrade path are both covered by `apps/api/test/migration.test.ts`.

## Tests

267 passing; 0 skipped. New this sprint: catalog identifier/match tests (16), scoring
eligibility tests, API tests for identity, trust/anomaly/corroboration, validation
hardening, daily rollup semantics (median equality with `collapseToDailySeries`,
idempotency, quarantine exclusion, status flip, restart), archive export → checksum →
read-back → idempotent rerun, 32 adversarial security tests, 10 new adapter tests.

## Largest load test and performance findings

Largest run: **5,000,200 synthetic observations / 10,000 listings** (disposable DB).
Details: `docs/PERFORMANCE_BASELINE.md`.

- Read paths are flat from 100K → 5M rows: latest ≈ 2 ms, history-180d ≈ 15 ms p50,
  analysis ≈ 15 ms p50, identity lookup ≈ 1 ms. Zero sequential scans in any plan.
- Bulk load ≈ 14k rows/s; API-path ingest ≈ 85 ms p50 (≈12 round trips per observation).
- Daily rollup: the initial per-day loop (~660 listing-days/s) did not finish 5M within an
  hour; rewritten set-based → 313 s for 2.73M listing-days (~8,700/s). This was the one real
  bottleneck found and fixed.
- **No index added** after review; candidates and reasons recorded.
- Database size at 5M: **1,061 MB** table + indexes (~212 bytes/row all-in; pkey 107 MB,
  `(listingId, effectiveAt)` 280 MB, `dataSourceId` 31 MB). Archive ≈ 270 bytes/row
  parquet before any tuning.

## Security findings

No product-code vulnerability surfaced: all adversarial cases (malformed/huge bodies,
overflow, bad currency/retailer/URL/identifier, future/ancient timestamps, XSS/SQL-like
text, error leakage, rate limit) are rejected or neutralised by existing controls
(`docs/SECURITY.md`). Findings requiring action:

1. **Extension default API base URL is `http://127.0.0.1:3000`** and lands in the production
   bundle and `host_permissions` unless `VITE_API_BASE_URL` is set — release blocker for any
   public build (not changed tonight; documented).
2. CORS allows any `chrome-extension://` origin by design (there is no secret to protect);
   documented rather than changed.

## Privacy findings

- No installation identifier or fingerprint was added; corroboration relies on
  source/time diversity only (documented limitation: one source persisting across UTC days
  can self-corroborate — mitigation planned, needs a privacy-reviewed signal).
- The extension still sends only: retailer, external id, URL, title, brand/model, price,
  reference price, currency, stock flag, variant selections, source/extractor/schema
  version, client timestamp. Load/bench tooling touches `_load` databases only.

## Blockers encountered

- `@dsnp/parquetjs@1.9.3` is published without `dist/`; pinned 1.8.9 (ADR-007).
- PostgreSQL forbids using a freshly added enum value in the same transaction → catalog
  migration split in two.
- First bench methodology was wrong (concurrent requests + rate-limiter 429s); redone
  sequentially, first numbers discarded.
- The API test suite truncates the dev database, so real MVP browsing history was not
  available for the upgrade path; the deterministic MVP-shaped sample is used.

## Known risks

- Corroboration self-heal by a single source across UTC days (above).
- `analysis` still reads all eligible raw rows per listing; fine at ~500 rows/listing,
  should move long ranges to `ListingDailyPrice` (trigger T2/T3).
- Match engine is deliberately conservative; many listings will stay `UNRESOLVED` until
  identifiers are harvested from pages/official APIs — that is the intended failure mode.
- Archive excludes mutable `status`; consumers of the archive cannot see quarantine until
  status-event archiving is built.
- Only `LocalFilesystemArchive` exists; no off-VM durability.
- Retailer DOM drift remains the top operational risk; fixtures cover known shapes only.

## What should be built next

1. Serve `history`/`analysis` long ranges from `ListingDailyPrice` behind the repository.
2. Scheduled job runner (cron/systemd) for rollup + archive; request/latency logging.
3. Identifier harvesting (UPC/model from PDP detail tables; Best Buy official API) to feed
   the match engine; a small review queue for `REVIEW`/`CONFLICT`.
4. `S3CompatibleArchive` (R2/S3) + status-event archiving.
5. Corroboration hardening (distinct-source requirement) with privacy review.

## Remaining before public beta

- Production API deployment (HTTPS), `VITE_API_BASE_URL` build configuration, matching
  `host_permissions`; store listing assets and privacy policy text.
- Job scheduling and monitoring; backups verified against the deployed database.
- Broader real-page validation across Amazon/Best Buy layouts over several days of normal
  browsing (no scripted hammering).
- Dependency audit gate in CI.

## PR

https://github.com/LandonGuenther/PriceTruth/pull/5
