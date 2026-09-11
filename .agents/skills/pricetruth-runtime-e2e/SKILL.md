---
name: pricetruth-runtime-e2e
description: Restore and test the PriceTruth Chrome extension, Fastify API, DEV Postgres, quarantine lifecycle, rollups, and archive without truncating live evidence.
---

# PriceTruth runtime E2E

## Devin Secrets Needed
- Root `.env` with DEV `DATABASE_URL`; load without printing.
- No retailer account is required for public PDP testing. Optional
  `BESTBUY_API_KEY` enables enrichment; absence should report enrichment disabled.

## Restore local services
From the repository root:
1. Load `.env` with `set -a; source .env; set +a`.
2. Parse `DATABASE_URL` and verify its database pathname is `/pricetruth`.
   Never use `pricetruth_load` for this workflow.
3. `pnpm install`, `docker compose up -d db`.
4. `pnpm --filter @pricetruth/api exec prisma migrate deploy`.
5. `pnpm --filter @pricetruth/api db:seed`.
6. `pnpm build`, then `pnpm --filter @pricetruth/api start`.
7. Check `http://127.0.0.1:3000/health` returns 200 and `db:"ok"`.
8. Reload unpacked `apps/extension/dist` at `chrome://extensions`.
   Pin/click the PriceTruth toolbar action to open the side panel.

Do not run the truncating test suite against the active API database.
Initial PDP navigation automatically ingests; record baseline counts before
navigating, and disclose any ingestion during access setup.

## Retailer evidence
- Use current canonical PDP links, preserving query parameters. A Best Buy
  path without its marketplace query may fail while the canonical search result
  loads. SKU 10129617 previously worked with `?loc=marketplace`.
- Compare screenshots of own-product buy-box prices with side panel and DB cents.
  Cross-sell, per-unit, format-selector "from", used, and installment prices are
  not proof of a current total product price.
- Hidden-price pages should produce no observation. Check DB count before/after.
- Stop on Amazon CAPTCHA/throttling; never bypass or rapidly reload.
- If many candidate PDPs hide prices, inspect existing DOM read-only for
  environment masking such as `devin-hidden`. Do not remove the mask. Report
  the limitation rather than attributing all hidden prices to Amazon.
- Do not claim variant-positive coverage without an actually visible price.

## Persistence and operations
- Join `PriceObservation`, `Listing`, `DataSource` (source field is `key`),
  `ObservationStatusEvent`, and `IdentifierAssertion`.
- Verify statuses/events independently of HTTP `accepted:true`: that response
  means a row was ingested and can also accompany a QUARANTINED row.
- Dedupe uses exact price/reference/currency/source within one hour. To exercise
  anomaly context via authorized curl tests, use distinct nearby cents and a
  distinctive `x-pricetruth-client-version` header.
- At least three recent eligible client observations are needed for the >60%
  median-move quarantine rule. Verify excluded counts and actual history points.
- Scoring `recordedLowCents` uses daily medians, not raw observation minimum.
  `ListingDailyPrice.lowCents` is the raw eligible daily minimum.
- Run `pnpm --filter @pricetruth/api jobs rollup`; compare accepted-only daily
  count/min/max/median/first/last against known test observations.
- Run `pnpm --filter @pricetruth/api jobs archive --dir <temporary-dir>
  --max-batches 1`; verify readable Parquet with installed `@dsnp/parquetjs`,
  manifest counts/ID bounds and SHA256. Raw archive includes quarantined facts
  but deliberately omits mutable status.
- Test request limits last. A 70 KiB JSON body should yield 413. A fresh
  loopback source via `curl --interface 127.0.0.2` isolates the 120/min bucket:
  requests 1–120 return 200, request 121 returns 429.

Record UI tests; save shell/API/DB/job output as text evidence. Leave API and
Postgres running and report any test-created DEV rows left behind.
