# Overnight foundation audit

Snapshot of the repository at `main` = `0ca7000` (MVP + Phase 2 data hardening), taken
before the foundation sprint began. Baseline: `pnpm install`, `lint`, `format:check`,
`typecheck`, `test` (182 tests: shared 14, scoring 34, retailer-adapters 79, extension 24,
api 31 incl. fresh + upgrade migration paths against PostgreSQL 16), `build` — all green.

## Current architecture

- **pnpm monorepo**, TypeScript strict, Node 22. Packages: `shared` (zod schemas, types,
  retailer registry), `scoring` (deterministic stats, Deal Score, Discount Integrity,
  confidence), `retailer-adapters` (Amazon/Best Buy DOM extraction with HTML fixtures).
  Apps: `api` (Fastify + Prisma/PostgreSQL) and `extension` (Chrome MV3: content script →
  service worker → side panel).
- **Data model** (Phase 2): `Retailer` (natural key) → `Listing` (UUID, unique
  retailer+externalId) → `PriceObservation` (BIGINT identity, append-only, DB trigger blocks
  UPDATE/DELETE) with `DataSource` provenance, `priceType`/`referenceType` semantics,
  `receivedAt`/`clientObservedAt`/`effectiveAt`, `status`, `synthetic`, `schemaVersion`,
  `extractorVersion`. `ListingVariant` holds fingerprinted variant JSON off the fact table.
  `Product` + `ProductIdentifier` exist but are created 1:1 per listing.
- **Ingestion**: `POST /v1/observations` → zod validation → time policy → listing upsert →
  dedupe window → insert. Optional Best Buy official-API enrichment writes a second,
  server-fetched observation.
- **Analysis**: `analysisService` queries eligible rows directly through Prisma
  (`synthetic=false`, `status=ACCEPTED`, `priceType IN (STANDARD, SALE)`), collapses to a
  daily median series in memory, and scores.
- **CI**: GitHub Actions with PostgreSQL 16 service; migrations, lint, format, typecheck,
  test, build.

## Strengths

- Immutable fact table enforced at the database layer, not only in code.
- Server-authoritative time; client clock skew is measured and bounded.
- Explicit provenance (`DataSource`, trust class, redistribution review metadata) and
  payload/extractor versioning already exist before real data accumulates.
- Deterministic scoring with the two scores kept independent; insufficient history is
  reported honestly.
- Minimal extension permissions (`sidePanel`, `storage`, API host only); no UA hash or
  other fingerprint retained.
- Fresh and upgrade migration paths are tested.

## Beta blockers

1. **Amazon cross-sell price contamination** - **mitigated (extension/adapters)**: buy-box
   scoped extraction rejects foreign-ASIN / carousel prices; covered by
   `hidden-price-cross-sell` and `cross-sell-with-buybox` fixtures. Historical note: a
   global `.a-price-whole` fallback previously leaked recommended prices under the
   target ASIN. Live PDP confirmation still belongs on the beta checklist.
2. **No anti-poisoning** (backend-owned): any client can post any price; a single
   `$999 → $9` observation enters history as `ACCEPTED` and moves the medians.
3. **Identity is per-listing** (backend/catalog-owned): the same product on Amazon and
   Best Buy never shares history; identifier validation / conflict tracking is a
   catalog concern.
4. **Validation gaps** (backend-owned): URL hostname vs retailer, identifier format per
   retailer, field lengths, variant payload size, request body size, and
   `referencePrice > price` are not all enforced server-side; 5xx responses may echo
   internal error messages.

## Long-term scaling hazards

- Analysis reads raw rows for the whole listing history on every request; no derived
  daily table, no repository seam for a future analytical store.
- No archive/backup path independent of PostgreSQL.
- No load measurements; index set was designed by reasoning, not by evidence.
- Jobs (aggregation, archive, corroboration) do not exist yet; must be idempotent and
  restartable from day one to avoid a queue/broker later.

## Data model risks

- `Product`/`ProductIdentifier` values are stored unnormalized (GTIN length varies, ASIN
  case unverified); `@@unique([type, value])` can therefore both false-split and collide.
- `ObservationStatus` has no distinction between "not yet trusted" and "trusted";
  no `actor` on status events.
- `Listing.gtin/brand/modelNumber` are mutable last-writer-wins metadata with no
  assertion history.

## Identity risks

- Any future "merge by title" would create false merges (worse than missed merges);
  no guard rails exist yet.
- Refurbished/used/generation/capacity variants are not distinguishable at the
  product level.

## Privacy / security risks

- Positive: no persistent client identifier, no PII, no UA hash, minimal permissions.
- Rate limit is per IP only; no request body limit configured; error handler leaks
  `error.message` for 5xx.
- Extension renders retailer-provided titles via React (escaped) — safe, but never
  audited against hostile fixtures.
- Secret API keys must never be shipped in the extension (currently none are).

## Performance risks

- `(listingId, effectiveAt)` index supports history; `getAnalysis` still loads every
  eligible row for the listing — fine at thousands of rows per listing, unmeasured beyond.
- No measurement of ingestion throughput or p95 of history/analysis endpoints.
- Dedupe query per insert is an index range scan on the same index; acceptable.

## Sprint plan derived from this audit

P1 catalog identity → P2 trust/anomaly/eligibility → P3 repository, daily rollup, archive
→ P4 load test + index review → P5 security → P6 Amazon fix → P7 docs/ADRs/report.
