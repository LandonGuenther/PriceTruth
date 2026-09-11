---
name: pricetruth-extension-e2e
description: Restore and test the local PriceTruth MV3 extension through Fastify and Postgres against real retailer product pages.
---

## Devin Secrets Needed
- No retailer login or API key is needed for DOM-based extension testing.
- Root `.env` must supply DATABASE_URL. BESTBUY_API_KEY is optional enrichment;
  do not request it merely to test content-script ingestion.
- Never print or attach `.env`.

## Restore local services
From the repository root:
```sh
docker compose up -d db
set -a
source .env
set +a
pnpm install
pnpm --filter @pricetruth/api exec prisma migrate deploy
pnpm --filter @pricetruth/api db:seed
pnpm build
pnpm --filter @pricetruth/api start
```
Use `start`, not `dev` unless package scripts change. API readiness is
`http://127.0.0.1:3000/health`, expected JSON db=ok.

## Browser flow
- Maximize Chrome; load `apps/extension/dist` at chrome://extensions in
  Developer mode, or click Reload if already installed.
- Pin PriceTruth, then click its toolbar action to open its side panel.
- Navigate to a real supported PDP; ingestion happens automatically, even
  during access setup before recording. Record baseline DB counts accordingly.
- For duplicate testing, reload the product page; content-script in-memory
  dedupe otherwise prevents another POST without reload.
- Capture passive service-worker network bodies if exact POST accepted/
  duplicate/observationId evidence is needed. Node 22's native WebSocket can
  connect to Chrome's CDP endpoint without installing Python websocket modules.
  Discover the actual debug port from the browser process; do not assume 9222.
- Compare actual visible PDP price/reference against the panel, wire payload,
  and DB—not just panel versus payload, which could share the same wrong
  extraction. If a retailer hides the main price, verify fallback selectors
  do not accidentally use recommendation/cross-sell prices.
- Do not aggressively retry throttled retailer requests, buy anything, or
  add items to cart merely to obtain a test price.

## Persistence and API checks
Use `docker compose exec -T db psql -U pricetruth pricetruth`.
Join PriceObservation to Listing and DataSource; verify price/reference,
schema/extractor version, clientObservedAt, effectiveAt=receivedAt, and skew.
Observation IDs are BIGINT, serialized as decimal strings in POST responses.
Check analysis/history effectiveAt and null scores when history is insufficient.
Reject unsupported/missing schema versions, non-client sources, and zero prices.
Try price UPDATE/DELETE only on a known test-observed row; both should fail
with append-only errors, and the row should remain unchanged.

## Safety
Do not run `pnpm test` against the live API database: tests truncate tables.
Do not clean evidence by truncating or disabling append-only triggers.
Leave DB/API running when requested; stop only testing instrumentation.
