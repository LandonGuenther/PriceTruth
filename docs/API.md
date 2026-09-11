# API (V1)

Base URL: `http://127.0.0.1:3000` (configurable via `PORT`/`HOST`).

All bodies are JSON. Validation and business errors return
`{ "error": string, "message": string }` with no stack traces. Unknown routes
return 404 `{ "error": "not_found" }`.

CORS allows `chrome-extension://*` origins (the extension calls the API from a
service worker) plus anything in `CORS_ORIGINS`. The write endpoint is protected
by a 120 req/min per-IP rate limit.

## `GET /health`

```json
{ "status": "ok", "product": "PriceTruth", "db": "ok" }
```

`db` is `"ok"` or `"error"` (performs `SELECT 1`).

## `POST /v1/observations`

Body: a `RetailerObservation` (see `packages/shared/src/observation.ts`).
Headers: `x-pricetruth-client-version` (stored on the row), `user-agent`
(sha256'd into `userAgentHash`).

Rejects with 400 when: the body fails schema validation, `observedAt` is more
than 10 minutes in the future or more than 7 days old.

```sh
curl -X POST http://127.0.0.1:3000/v1/observations \
  -H 'content-type: application/json' \
  -H 'x-pricetruth-client-version: 0.1.0' \
  -d '{
    "retailer": "amazon", "externalId": "B0DEMOASIN",
    "url": "https://www.amazon.com/dp/B0DEMOASIN", "title": "Acme Widget",
    "priceCents": 29900, "referencePriceCents": 49900, "currency": "USD",
    "source": "extension:content-script", "observedAt": "2025-06-30T12:00:00.000Z"
  }'
```

Response 201:

```json
{
  "accepted": true,
  "duplicate": false,
  "listingId": "…",
  "observationId": "…",
  "enrichment": { "bestbuyApi": "skipped" }
}
```

Duplicates (same price/reference/currency/source within ±60 min of `observedAt`)
return 200 with `duplicate: true` and the existing `observationId`.

For Best Buy observations with `BESTBUY_API_KEY` configured, an enrichment
observation from the official Products API may be recorded;
`enrichment.bestbuyApi` is one of `recorded` | `duplicate` | `skipped` |
`disabled` | `error`.

## `GET /v1/listings/:retailer/:externalId/analysis`

404 `{ "error": "listing_not_found" }` for unknown listings. Otherwise returns
`AnalysisResponse` (shared type): current price, typical price + window, full
`HistoricalStats`, confidence, Discount Integrity and Deal Score, computed at
request time over all non-synthetic observations.

## `GET /v1/listings/:retailer/:externalId/history?days=180`

`days`: integer 1–730, default 180. Returns `HistoryResponse` — raw observation
points (ascending) and the daily-median series used by scoring.
