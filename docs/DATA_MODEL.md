# Data Model (V1)

Postgres via Prisma (`apps/api/prisma/schema.prisma`). Migrations under
`apps/api/prisma/migrations`.

## Entities

- **Retailer** — `amazon` | `bestbuy` (id matches `RetailerId` in
  `@pricetruth/shared`). Seeded idempotently by `pnpm --filter @pricetruth/api db:seed`
  and lazily upserted on first observation so a fresh DB works without seeding.
- **Product** — canonical product (`title`, `brand?`, `modelNumber?`). In the MVP a
  Product is created **1:1 per Listing** on first observation — no cross-retailer
  merging yet.
- **ProductIdentifier** — `(type, value)` pairs (`GTIN`, `UPC`, `EAN`, `MPN`,
  `ASIN`, `BESTBUY_SKU`), unique per type+value, recorded so merging can be added
  later. A GTIN that already belongs to another product is skipped rather than
  re-linked.
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
  - lifecycle: `status` (`ACCEPTED`/`QUARANTINED`/`EXCLUDED`) — the only
    mutable column.
- **ObservationStatusEvent** — append-only log of `status` transitions
  (`observationId`, `fromStatus`, `toStatus`, `reason`, `createdAt`).

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
