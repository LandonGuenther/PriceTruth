# Security

Threat model, controls, and the adversarial test evidence for the PriceTruth API and
extension. Status labels: **IMPLEMENTED** (covered by tests in the repo), **PLANNED**,
**FUTURE**.

## Threat model

The browser extension is fully inspectable by anyone who installs it. Therefore:

- there is **no secret in the extension**; any client can call `POST /v1/observations`;
- every client-supplied field is untrusted: prices, timestamps, identifiers, titles, URLs;
- the interesting attacks are **data poisoning** (fake prices, fake history, fake
  timestamps), **resource abuse** (huge bodies, floods), and **injection** into storage or
  the side panel — not credential theft, because there are no credentials to steal.

Data-poisoning defences (trust states, anomaly quarantine, corroboration, eligibility) are
described in `docs/DATA_QUALITY.md`; this document covers input handling, transport and
error hygiene.

## Controls — IMPLEMENTED

| Area                  | Control                                                                                                                                                                                               | Evidence (`apps/api/test/security.test.ts`)                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Payload shape         | Zod schema on every route; unknown/invalid → `400 invalid_observation` (or `unsupported_schema_version`)                                                                                              | malformed JSON → 400; `text/plain` with JSON body → 400                  |
| Body size             | Fastify `bodyLimit` 64 KiB                                                                                                                                                                            | ~70 KiB body → 413                                                       |
| Field lengths         | title ≤ 1000, externalId ≤ 64, brand/modelNumber ≤ 200, url ≤ 2048, source ≤ 100, extractorVersion ≤ 32                                                                                               | 5,000-char title → 400                                                   |
| Variant payload       | ≤ 20 keys, key ≤ 64, value ≤ 200, string values only                                                                                                                                                  | 200 keys / 5,000-char value / nested object → 400                        |
| Numbers               | `priceCents` positive Int32; `referencePriceCents` positive Int32 and > price                                                                                                                         | 0, −1, 1.5, 2³¹, 2⁵³+1, `"100"` → 400; reference ≤ price → 400           |
| Currency              | 3 uppercase letters (`[A-Z]{3}`)                                                                                                                                                                      | `usd`, `US`, `USDD`, `U$D` → 400                                         |
| Time                  | `clientObservedAt` > 10 min in future or > 7 days old rejected; `effectiveAt = receivedAt` for client sources (`ADR-004`)                                                                             | +1 h → 400, no row; 8 days old → 400, no row                             |
| Retailer / identifier | retailer enum; ASIN `^[A-Z0-9]{10}$`; Best Buy SKU digits                                                                                                                                             | `walmart`, lowercase ASIN, 9-char ASIN, `abc` SKU → 400                  |
| URL                   | hostname must be the retailer's exact host or subdomain                                                                                                                                               | `amazon.com.evil.example`, `evil.example/?u=amazon.com` → 400            |
| Source claims         | client may only claim `CLIENT_REPORTED` data sources                                                                                                                                                  | api.test.ts (trusted-source rejection)                                   |
| SQL injection         | Prisma parameterised queries only; raw SQL uses `$queryRaw`/`Prisma.sql` with bound parameters                                                                                                        | SQL-like title stored verbatim; `' OR 1=1--` in path → 404; table intact |
| Stored XSS            | Titles stored verbatim, served only as `application/json`; side panel renders via React text nodes — no `dangerouslySetInnerHTML` / `innerHTML =` anywhere in `apps/extension/src` (asserted by test) | XSS title → 201, JSON-encoded on read                                    |
| Error hygiene         | Global error handler returns `{ error: "internal_error", message: "Internal error" }` for 5xx; internals only logged                                                                                  | injected `Error("secret internal detail")` → 500 with sanitised body     |
| Rate limit            | `@fastify/rate-limit` 120 req/min per IP                                                                                                                                                              | 121st request → 429                                                      |
| CORS                  | `@fastify/cors`: no-`Origin` callers and any `chrome-extension://` origin allowed; all other origins only if listed in `CORS_ORIGINS` (env, default empty)                                            | app.ts                                                                   |
| Database              | append-only triggers forbid UPDATE/DELETE on `PriceObservation`; CHECK constraints on price/reference/currency                                                                                        | migration tests, api.test.ts                                             |
| Extension secrets     | Production bundle scanned: no `BESTBUY_API_KEY`, `DATABASE_URL`, `postgres://`, or token-like literals                                                                                                | bundle-scan test                                                         |
| Extension permissions | `sidePanel`, `storage`, retailer host matches only; no `tabs`, `history`, `cookies`, `webRequest`, `<all_urls>`                                                                                       | `apps/extension/src/manifest.ts`                                         |

## Findings from the security pass

1. **Default API base URL is `http://127.0.0.1:3000`** and is compiled into the production
   bundle (`host_permissions` and the service worker) unless `VITE_API_BASE_URL` is set at
   build time. Not a secret leak, but a **release blocker**: a store build must set the
   production HTTPS origin, and the manifest's `host_permissions` must match it. Tracked in
   `docs/OVERNIGHT_AUDIT.md` → remaining before public beta. Unchanged tonight.
2. No product-code vulnerabilities were surfaced by the adversarial suite; every case was
   already rejected by existing validation. One test-infrastructure race (parallel test
   files sharing one database) was fixed with `fileParallelism: false`.

## PLANNED

- Per-route request logging with latency for production measurement (feeds
  `docs/SCALE_TRIGGERS.md`).
- Abuse controls beyond per-IP rate limiting (per-listing submission caps) if extension
  traffic is abused; kept minimal to avoid fingerprinting (`docs/PRIVACY.md`).
- Dependency audit in CI (`pnpm audit --prod` gate).
- HTTPS-only enforcement and HSTS at the deployment edge (no deployment exists yet).

## FUTURE

- Signed extension releases with build provenance.
- Optional installation-level corroboration signal — only if data quality demands it and
  only under the privacy constraints in `docs/PRIVACY.md`.

## Reporting

Security issues: open a private report to the repository owner. Do not file public issues
for exploitable problems.
