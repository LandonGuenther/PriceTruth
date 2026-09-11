# Data Model (V1)

Postgres via Prisma (`apps/api/prisma/schema.prisma`). Migrations under
`apps/api/prisma/migrations`.

## Entities

- **Retailer** — `amazon` | `bestbuy` (id matches `RetailerId` in
  `@pricetruth/shared`). Seeded idempotently by `pnpm --filter @pricetruth/api db:seed`
  and lazily upserted on first observation so a fresh DB works without seeding.
- **Product** — the canonical variant-level purchasable product (`title`,
  `brand?`, `modelNumber?`, `familyId?`). The match engine links listings to a
  shared product on strong identifier evidence (EXACT/HIGH); otherwise a 1:1
  Product is created. See docs/CATALOG_IDENTITY.md.
- **ProductFamily** — product line above Product (e.g. "Sony WH-1000XM6").
  Schema exists; population is PLANNED (families are manual for now).
- **ProductIdentifier** — `(type, value)` pairs (`GTIN`, `UPC`, `EAN`, `MPN`,
  `ASIN`, `BESTBUY_SKU`, `MANUFACTURER_MODEL`), unique per type+value. Values
  are stored normalized: GTIN-family → 14-digit GTIN, ASIN → uppercase, and
  model types store the match key (separators stripped) so lookups are index
  hits. Conflicts are skipped rather than re-linked.
- **IdentifierAssertion** — every identifier a data source has asserted about a
  listing (raw + normalized, `valid`, `status`, first/last seen). Upserted on
  each observation.
- **MatchEvidence** — audit log of `evaluateMatch` runs (level, machine-readable
  reason codes, `engineVersion`).
- **ProductLinkEvent** — audit log of `productId` changes (LINK/UNLINK,
  previous/new product, reason, actor).
- **Listing** — `(retailerId, externalId)` unique. Descriptive metadata only
  (`url`, `title`, `brand`, `modelNumber`, `gtin`) — refreshed to the newest
  observed values. **No price fields**: there is no mutable `currentPrice` by
  design; the "current price" is always derived from the newest observation.
- **ListingVariant** — a listing attribute tuple (size/color/etc.) deduplicated
  by `fingerprint` = sha256 of the canonical sorted-keys JSON of `attributes`.
  `@@unique([listingId, fingerprint])`; observations with identical attribute
  payloads share a row.
- **DataSource** — `key` (unique), `type` (`EXTENSION`/`API`/`MANUAL`/`SYNTHETIC`),
  `trustClass` (`CLIENT_REPORTED`/`SERVER_FETCHED`/`VERIFIED`/`TEST`),
  `redistributionReviewStatus` (metadata for counsel review; the code makes no
  legal determination). Seeded by the data-foundation migration and by
  `DATA_SOURCE_DEFINITIONS` in `@pricetruth/shared`.
- **PriceObservation** — the append-only fact (`BigInt` autoincrement id;
  serialised as a decimal string in API responses):
  - price: `priceCents`, `priceType` (`STANDARD`/`SALE`/`MEMBER`/`SUBSCRIPTION`/
    `COUPON_REQUIRED`/`INSTALLMENT`/`USED`/`REFURBISHED`/`MARKETPLACE`/`UNKNOWN`;
    default `UNKNOWN`), `referencePriceCents?`, `referenceType?` (`WAS_PRICE`/
    `LIST_PRICE`/`MSRP`/`COMP_VALUE`/`REGULAR_PRICE`/`UNKNOWN`; required iff a
    reference price is present), `currency`, `inStock?`;
  - identity: `listingId`, `variantId?`, `dataSourceId`;
  - time: `receivedAt` (server), `clientObservedAt?` (as reported),
    `effectiveAt` (what dedup/history/scoring use — see ADR-004),
    `clientSkewSeconds?`;
  - provenance: `schemaVersion` (≥1), `clientVersion?`, `extractorVersion?`,
    `synthetic` (default `false`);
  - lifecycle: `status` (`RECEIVED`/`ACCEPTED`/`CORROBORATED`/`QUARANTINED`/
    `EXCLUDED`) — the only mutable column. `RECEIVED` is transient: it exists
    only as `fromStatus` on the first status event (see docs/DATA_QUALITY.md).
- **ObservationStatusEvent** — append-only log of `status` transitions
  (`observationId`, `fromStatus`, `toStatus`, `reason`, `actor`, `createdAt`).
- **ListingDailyPrice** — deterministic per-listing per-UTC-day rollup of
  eligible observations (count, low/high/median, first/last, reference median,
  distinct `sourceCount`, `aggregationVersion`). Written by the rollup job,
  keyed `@@unique([listingId, day])`; not yet read by analysis (PLANNED —
  docs/DATA_PLATFORM.md).
- **JobCheckpoint** — durable cursor rows (`jobName`, `cursor`, `updatedAt`)
  for batch jobs (`rollup:*`, `archive:*`).
- **ArchiveBatch** — ledger of exported parquet partitions (`key` unique,
  first/last observation id, `rowCount`, `sha256`, `createdAt`). The archive
  itself lives outside Postgres — see docs/ARCHIVE_FORMAT.md.

## Integrity constraints

Beyond Prisma-expressible rules the migration adds CHECKs: `priceCents > 0`,
`referencePriceCents > 0`, `referencePriceCents IS NULL` ⇔ `referenceType IS
NULL`, `currency ~ '^[A-Z]{3}$'`, `schemaVersion >= 1`, non-empty
`Listing.externalId` and `DataSource.key`.

## Immutability rules

`PriceObservation` rows are append-only, enforced in the database by the
`pricetruth_forbid_observation_mutation()` trigger: DELETE always raises; UPDATE
raises unless only `status` changed. Status transitions go through
`setObservationStatus(prisma, id, toStatus, reason)`, which updates the row and
appends an `ObservationStatusEvent` in one transaction — no route exposes it.
Corrections are expressed as new observations. See ADR-001.

## Dedup rule

An incoming observation is rejected as a duplicate (HTTP 200,
`duplicate: true`) when an existing row for the same listing has identical
`priceCents`, `referencePriceCents` (null-equal), `currency` and `dataSourceId`,
and an `effectiveAt` within ±60 minutes of the incoming `effectiveAt`. `status`
is excluded from dedup — a quarantined identical row is still the same event.

## Eligibility

Analysis and history use only observations with `synthetic = false`,
`status = 'ACCEPTED'`, and `priceType ∈ {STANDARD, SALE}`
(`ELIGIBLE_PRICE_TYPES` in `@pricetruth/scoring`). `USED`, `MEMBER`,
`UNKNOWN`, etc. are stored but never scored.

## Synthetic data policy

Rows with `synthetic: true` are excluded from analysis and history. Clients
cannot create them: `POST /v1/observations` rejects any `source` whose
`DataSource.trustClass` is not `CLIENT_REPORTED` — only server-side paths (the
Best Buy enrichment writer, seeds, tests) can write `SERVER_FETCHED`/`VERIFIED`/
`TEST` rows.

## Best Buy product URLs

Best Buy serves two PDP URL formats: legacy `/site/<slug>/<sku>.p` (SKU in the
URL) and new `/product/<slug>/<opaque code>` (no SKU in the URL). In both cases
the adapter treats the **page SKU** as the listing `externalId` — JSON-LD
`Product.sku`/`offers[].sku` first, then the "SKU: …" label — falling back to
the URL SKU only when the page carries none. When a legacy URL SKU and the page
SKU disagree (e.g. marketplace listings where the URL was redirected), the page
value wins and a warning is recorded.

## Best Buy API usage

When `BESTBUY_API_KEY` is configured and an observation for a Best Buy listing
arrives, the API calls the official Best Buy Products API once per listing per
hour at most (skipped when a `bestbuy:products-api` row exists in the last 60
minutes; the standard dedup rule also applies to the enriched row). Failures are
logged and never fail the request. No scraping or stealth: the extension only
observes pages the user legitimately loads, and Best Buy data comes from their
official API.
