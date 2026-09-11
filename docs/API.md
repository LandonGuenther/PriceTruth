# API (V1)

Base URL: `http://127.0.0.1:3000` (configurable via `PORT`/`HOST`).

All bodies are JSON. Validation and business errors return
`{ "error": string, "message": string }` with no stack traces. Unknown routes
return 404 `{ "error": "not_found" }`. Bodies over `BODY_LIMIT_BYTES` (default
64 KiB) return 413. Any 5xx returns
`{ "error": "internal_error", "message": "Internal error" }` — internals are
never leaked.

Every response carries `x-pricetruth-api-version: 1`,
`x-pricetruth-observation-schema-version: 1`, and an `x-request-id` echo
(a valid inbound `^[A-Za-z0-9._-]{1,128}$` id is honoured, else a UUID is
generated). `apiVersion: 1` is also present in success response bodies
(ingest result, analysis, history, health, readiness).
See docs/API_COMPATIBILITY.md.

Rate limits are per-IP (`request.ip`, honouring `TRUST_PROXY`), per endpoint
class, per minute, and return `429 { "error": "rate_limited", "message",
"retryAfterSeconds" }`:

| Class  | Endpoints                       | Default limit                        |
| ------ | ------------------------------- | ------------------------------------ |
| ingest | `POST /v1/observations`         | 60 (`RATE_LIMIT_INGEST_PER_MINUTE`)  |
| read   | `GET /v1/listings/*/analysis    | history`                             | 240 (`RATE_LIMIT_READ_PER_MINUTE`) |
| health | `GET /health`, `GET /readiness` | 600 (`RATE_LIMIT_HEALTH_PER_MINUTE`) |

CORS: requests without an `Origin` header are always allowed.
`chrome-extension://<id>` origins are allowed when `ALLOWED_EXTENSION_IDS` is
unset, or restricted to the listed extension ids when set. Other origins are
allowed only when present in `CORS_ORIGINS`. `*` is never returned.

## `GET /health`

Liveness — always 200 while the process is up; `db` is `"ok"` or `"error"`
(performs `SELECT 1`) but does not affect the status.

```json
{
  "status": "ok",
  "product": "PriceTruth",
  "db": "ok",
  "apiVersion": 1,
  "uptimeSeconds": 12,
  "version": "dev"
}
```

`version` is `APP_VERSION` (git sha in containers) or `"dev"`.

## `GET /readiness`

200 only when the DB is reachable (`SELECT 1` within 2 s) and the latest
migration directory is recorded in `_prisma_migrations`.

```json
{ "status": "ready", "checks": { "database": "ok", "migrations": "ok" }, "apiVersion": 1 }
```

Not ready → 503 `{ "status": "not_ready", "checks": { "database": "ok"|"error",
"migrations": "ok"|"pending"|"unknown" }, "apiVersion": 1 }`.

## `POST /v1/observations`

Body: a `RetailerObservation` (see `packages/shared/src/observation.ts`).
Required since the data-foundation migration: `schemaVersion: 1`, `priceType`;
`referenceType` is required iff `referencePriceCents` is present;
`extractorVersion` is optional. `observedAt` is the client-reported time — the
server stores it as `clientObservedAt` and applies the time policy in ADR-004.

Field bounds (400 `invalid_observation` on violation): `title` ≤1000 chars,
`brand`/`modelNumber` ≤200, `url` ≤2048, `source` ≤100, `extractorVersion` ≤32,
`externalId` ≤64 and must match the retailer's format (amazon `^[A-Z0-9]{10}$`,
bestbuy `^\d{1,12}$`); `url` hostname must belong to the retailer;
`gtin` = 8–14 digits; `priceCents`/`referencePriceCents` ≤ Int32 max and
`referencePriceCents` must exceed `priceCents`; `variant` ≤20 keys (key ≤64,
value ≤200 chars). Request bodies are limited to 64 KB.
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
  "status": "ACCEPTED",
  "listingId": "…",
  "observationId": "…",
  "enrichment": { "bestbuyApi": "skipped" }
}
```

`status` is the row's `ObservationStatus` after ingest (`ACCEPTED` |
`QUARANTINED` | `CORROBORATED` | `EXCLUDED`); for duplicates it reflects the
existing row's status, which may be `QUARANTINED` or already `CORROBORATED`.

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
request time over eligible observations (`synthetic = false`, `status ∈
{ACCEPTED, CORROBORATED}`, `priceType ∈ {STANDARD, SALE}` — see
docs/DATA_QUALITY.md). The top-level timestamp is `effectiveAt` (previously
`observedAt`). An `evidence` block reports `eligibleCount` plus per-reason
excluded counts (`synthetic`, `quarantined`, `excluded`, `priceType`).

## `GET /v1/listings/:retailer/:externalId/history?days=180`

`days`: integer 1–730, default 180. Returns `HistoryResponse` — raw observation
points (ascending; each point's timestamp is `effectiveAt`, plus `source` = the
DataSource key) and the daily-median series used by scoring.

## `GET /internal/metrics`

Process-local counters, no auth (localhost/ops use only). JSON:
`{ counters: [{ name, labels, count }], durations: [{ operation, count, p50,
p95, max }] }`. `?format=prometheus` renders the same counters and duration
quantiles in Prometheus text exposition format. Counters:
`requests_total{operation,status}`, `observations_total{outcome}`
(accepted|duplicate|quarantined), `job_runs_total{job,status}`
(succeeded|failed|skipped_locked); `request_duration_ms` per route. Process-local
— with multiple API replicas, sum/aggregate externally.

## `GET /internal/status`

Requires `Authorization: Bearer <INTERNAL_API_TOKEN>` (constant-time compare;
sha256-hashed before `timingSafeEqual`). When `INTERNAL_API_TOKEN` is unset —
or the token is wrong — the route returns 404 to reduce discoverability. The
payload mirrors `pnpm --filter @pricetruth/api ops status`:

- `latestObservationReceivedAt`, `observationsLastHour`, `observationsLast24h`,
  `statusDistribution` (observation count by status)
- `rollup`: `{ checkpoint, lastRun, lagObservations }` (JobRun row serialised;
  `lagObservations` = newest observation id − cursor)
- `archive`: `{ checkpoint, lastSuccessAt, lagObservations, batches }`
- `counts`: retailers / listings / products / families / dataSources
- `lastJobRuns`: 5 most recent JobRun rows (status, error, workerId, summary)

## Ops CLI

`pnpm --filter @pricetruth/api ops status` prints the same JSON as
`/internal/status` straight from the DB (no auth needed — it already holds
`DATABASE_URL`).

## Container

`apps/api/Dockerfile` builds a production image (multi-stage, node:22-alpine,
non-root, `CMD node dist/src/server.js`, healthcheck on `/health`).
`docker compose --profile api up` runs api+db together; the image also contains
the prisma CLI + `apps/api/prisma/` so `docker run ... pnpm exec prisma migrate
deploy` works in-container. SIGTERM/SIGINT drain in-flight requests
(`forceCloseConnections: "idle"`) and disconnect Prisma; hard exit after
`SHUTDOWN_TIMEOUT_MS` (default 10 s).
