# Data collection start

Status: **STAGING API LIVE** — controlled probes only so far; waiting on first legitimate retailer PDP observation from the Chrome extension.

## How real data enters PriceTruth

### Amazon (initial)

Browser extension observations only.

1. A person opens an Amazon PDP in Chrome with PriceTruth installed.
2. The extension reads the visible main price from the page.
3. If the price is clear and confident, it POSTs an observation to the staging HTTPS API (`https://pricetruth-api-staging.fly.dev`).
4. The API appends an immutable row in Neon.

There is no server-side Amazon scraping. CAPTCHA or hidden prices are not bypassed. If the page shows no usable price, PriceTruth records no observation.

### Best Buy

Two paths:

1. **Browser observations** - same extension flow as Amazon.
2. **Official Best Buy Products API refresh** - only for listings already known to PriceTruth, when `BESTBUY_API_KEY` is configured. Conservative schedule (about every 6 hours). Does not crawl the full catalog.

## Storage model

- Raw observations are **immutable** (append-only).
- Daily rollups (`ListingDailyPrice`) are **derived** and can be recomputed.
- History starts accumulating when real observations begin - there is **no fake backfilled retailer history**.
- Synthetic/test rows are marked / excluded and must not affect consumer scoring.

## Current collection state

| Source | State |
|--------|-------|
| Amazon extension | API + beta ZIP ready; awaiting owner Chrome PDP test |
| Best Buy extension | API + beta ZIP ready; awaiting owner Chrome PDP test |
| Best Buy official refresh | Not configured (`BESTBUY_API_KEY` absent) |
| Staging probes | 2 amazon probe rows present, both `EXCLUDED` |

When the first legitimate observation lands, update `docs/LIVE_BETA_REPORT.md` with retailer, external id, price, source, status, and received time (no secrets).
