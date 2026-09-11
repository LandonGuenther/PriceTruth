# Privacy

PriceTruth observes prices on pages the user is already looking at and stores
those observations to build price history. This document describes exactly what
leaves the browser and what the server retains.

## What the extension sends

On a supported product page (Amazon or Best Buy PDPs only — the content script
is host-restricted), the content script POSTs a `RetailerObservation` to the
API, containing:

- `retailer`, `externalId` (ASIN / Best Buy SKU), `url`, `title`
- `brand?`, `modelNumber?`, `gtin?`, `variant?` (e.g. size/color labels)
- `priceCents`, `referencePriceCents?`, `currency`, `inStock?`
- `source` (always `extension:content-script` from the extension),
  `observedAt` (the page-view time), `schemaVersion`, `priceType`,
  `referenceType?`, `extractorVersion`
- Header `x-pricetruth-client-version` — the extension build version

## What the server stores per observation

Listing metadata (title/brand/model/identifiers, refreshed on each sighting),
the price fields above, `dataSourceId`, `variantId` (into `ListingVariant`,
keyed by attribute fingerprint), `receivedAt` (server time),
`clientObservedAt`, `effectiveAt`, `clientSkewSeconds`, `schemaVersion`,
`clientVersion`, `extractorVersion`, `synthetic`, `status`. See
`docs/DATA_MODEL.md` for the full column list.

## What is NOT stored

- **Raw User-Agent.** Never persisted. Phase 2 also removed `userAgentHash`: a
  hashed UA is a stable cross-session fingerprint of the install, it was unused
  by dedup, and it collected data with no product purpose. If request-abuse
  controls are ever needed they will be short-lived, request-scoped rate limits
  — nothing persisted on the observation row.
- **Accounts.** There are none. No sign-up, no login, no user identifier.
- **Cookies / tracking.** None set; no analytics, no third-party beacons.
- **Browsing history.** The extension holds no `tabs` permission and cannot see
  which URLs you visit. It runs on supported retailer hosts only; a background
  `pt/ping` to the content script checks whether the tab still shows a
  supported page — the URL is never read or sent.

## Permissions (MV3)

`sidePanel`, `storage` (per-tab state), `activeTab`-equivalent host access to
supported retailer domains and the API origin. No `tabs`, no broad `<all_urls>`
host permissions, no remote code.

## Synthetic data

Rows may be marked `synthetic` only by the `synthetic:test` data source, which
is not claimable by any client. Synthetic rows are excluded from analysis and
history, keeping demo/test data separated from real observations. Load and
benchmark tooling (`loadgen`/`bench`) writes generated rows only to a
disposable `*_load` database and refuses any other target.

## No installation identifier

The extension sends no install ID, device ID, or per-client token — corroboration
deliberately does not use an installation-level signal (see
`docs/DATA_QUALITY.md` known limitations).
