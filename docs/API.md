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
Required since the data-foundation migration: `schemaVersion: 1`, `priceType`;
`referenceType` is required iff `referencePriceCents` is present;
`extractorVersion` is optional. `observedAt` is the client-reported time — the
server stores it as `clientObservedAt` and applies the time policy in ADR-004.
Headers: `x-pricetruth-client-version` (stored on the row). The User-Agent is
never stored.

`source` must resolve to a `DataSource` row whose `trustClass` is
`CLIENT_REPORTED` — clients cannot claim `bestbuy:products-api`, `manual`,
`synthetic:test`, or any future server/verified/test source.

Errors: `400 {"error":"invalid_observation"}` for schema failures, unknown or
non-client sources, referenceType without referencePriceCents (or vice versa),
and `observedAt` more than 10 minutes in the future or more than 7 days old;
`400 {"error":"unsupported_schema_version"}` for a numeric `schemaVersion`
other than 1 (pre-check, before full parsing).

```sh
curl -X POST http://127.0.0.1:3000/v1/observations \
  -H 'content-type: application/json' \
  -H 'x-pricetruth-client-version: 0.1.0' \
  -d '{
    "retailer": "amazon", "externalId": "B0DEMOASIN",
    "url": "https://www.amazon.com/dp/B0DEMOASIN", "title": "Acme Widget",
    "priceCents": 29900, "referencePriceCents": 49900, "currency": "USD",
    "source": "extension:content-script", "observedAt": "2025-06-30T12:00:00.000Z",
    "schemaVersion": 1, "priceType": "STANDARD", "referenceType": "UNKNOWN",
    "extractorVersion": "1.0.0"
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

`observationId` is the row's BIGINT key serialised as a decimal string (JSON has
no 64-bit integer). Duplicates (same price/reference/currency/dataSource within
±60 min of `effectiveAt`) return 200 with `duplicate: true` and the existing
`observationId`.

For Best Buy observations with `BESTBUY_API_KEY` configured, an enrichment
observation from the official Products API may be recorded;
`enrichment.bestbuyApi` is one of `recorded` | `duplicate` | `skipped` |
`disabled` | `error`.

## `GET /v1/listings/:retailer/:externalId/analysis`

404 `{ "error": "listing_not_found" }` for unknown listings. Otherwise returns
`AnalysisResponse` (shared type): current price, typical price + window, full
`HistoricalStats`, confidence, Discount Integrity and Deal Score, computed at
request time over eligible observations (`synthetic = false`, `status =
'ACCEPTED'`, `priceType ∈ {STANDARD, SALE}`). The top-level timestamp is
`effectiveAt` (previously `observedAt`).

## `GET /v1/listings/:retailer/:externalId/history?days=180`

`days`: integer 1–730, default 180. Returns `HistoryResponse` — raw observation
points (ascending; each point's timestamp is `effectiveAt`, plus `source` = the
DataSource key) and the daily-median series used by scoring.
