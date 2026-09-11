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
- **PriceObservation** — the immutable event. `priceCents`,
  `referencePriceCents?` (a reference price is observed together with the price,
  on the same row — no separate table), `currency`, `inStock?`, `variant?`,
  `observedAt`, plus provenance fields folded into the same row: `source`,
  `clientVersion`, `receivedAt`, `userAgentHash` (sha256 of the UA header — the
  raw UA is never stored), and `synthetic` (test/demo rows, default `false`).

## Immutability rules

`PriceObservation` rows are append-only: the API exposes no update or delete
paths for them. Corrections are expressed as new observations.

## Dedup rule

An incoming observation is rejected as a duplicate (HTTP 200,
`duplicate: true`) when an existing row for the same listing has identical
`priceCents`, `referencePriceCents` (null-equal), `currency` and `source`, and an
`observedAt` within ±60 minutes of the incoming `observedAt`.

## Synthetic data policy

Rows with `synthetic: true` (seeded demo/test data) are excluded from analysis
and history responses. API-ingested observations are always `synthetic: false`.

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
