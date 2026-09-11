# Cursor handoff - public beta extension (post-Devin integration)

## Original Cursor base SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

(`origin/main` when `cursor/public-beta-extension` started; short `5e9dd67`, same as Devin handoff base.)

## New integrated main SHA

`57c5059b4c780f6a48cc6684844205d6f64db4ef`

(Merge pull request #9 from LandonGuenther/devin/production-backend-beta)

## New Cursor head SHA

`d9385c1bf61372fbbda84df9788ab7a594509691` (docs commit updating this file may follow)

## Branch

`cursor/public-beta-extension`

Rebased onto `57c5059b4c780f6a48cc6684844205d6f64db4ef`. **Conflicts: none** (clean rebase; no ours/theirs resolution).

## Owned / changed

- `apps/extension/**` - API client (`ApiRateLimitedError` / `retryAfterSeconds`, request id header, observation-schema version check, additive ingest fields, HTTPS package gate, pinned MV3 public `key`)
- `apps/api/test/security.test.ts` - allow Chrome public manifest `key` in secrets scan (false positive from the pin; not a backend architecture change)
- `packages/retailer-adapters/**` - unchanged this turn; still Cursor-owned
- Extension docs + this handoff

## Devin API changes integrated

From `docs/handoffs/devin-handoff.md` and live API on integrated main:

- Response headers: `x-pricetruth-api-version`, `x-pricetruth-observation-schema-version`, `x-request-id`
- Success bodies add `apiVersion: 1`
- Ops routes confirmed: `GET /health`, `GET /readiness`
- 429 body `{ error: "rate_limited", message, retryAfterSeconds }` mapped to `ApiRateLimitedError` (no auto-retry)
- Ingest additive fields: `status`, `enrichment`, `apiVersion` (type-checked when present)
- CORS allow-list (`ALLOWED_EXTENSION_IDS`) ready for pinned id `hkpcfcjmogoaakoemandjkkdgnhpdejk`
- `@pricetruth/shared` types: **no breaking changes**; additive fields handled in extension-local parsers

## Observation payload (extension -> API)

Posted only after confident extraction. `RetailerObservation` fields from `@pricetruth/shared`:

`retailer`, `externalId`, `url`, `title`, `brand`, `modelNumber`, `gtin`, `priceCents`, `referencePriceCents`, `currency`, `inStock`, `variant`, `source`, `observedAt`, `schemaVersion`, `priceType`, `referenceType`, `extractorVersion`

Client version header: `x-pricetruth-client-version`.

Not fabricated: confidence, trust, quarantine, enrichment outcomes.

## Data quality

Extraction failure reasons that never ingest: `not_product_page`, `no_identifier`, `no_price`, `ambiguous_price`, `invalid`.

Handler coverage confirms ambiguous/no-price paths do not call `POST /v1/observations`.
Backend owns trust/quarantine; extension owns safe extraction only.

## Shared types changed

None intentionally.

## Test totals

| Suite | Result |
| --- | --- |
| Extension (`@pricetruth/extension`) | **50** passed |
| Retailer adapters (`@pricetruth/retailer-adapters`) | **115** passed |
| Amazon fixtures | **23** |
| Best Buy fixtures | **15** |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass (needs `prisma generate` in this environment) |
| `pnpm build` | pass |
| API unit/integration | **130** passed; migration suite blocked by env (below) |

### Unrelated API failure (not caused by this branch)

`apps/api/test/migration.test.ts` cannot run here: Postgres role lacks `CREATEDB` (`permission denied to create database`). Extension code is not involved. Documented only; backend architecture not modified.

## Package verification

- `VITE_API_BASE_URL=https://api-staging.pricetruth.example pnpm --filter @pricetruth/extension build && pnpm --filter @pricetruth/extension package && pnpm --filter @pricetruth/extension verify-package`
- Result: **ok** - `apps/extension/release/pricetruth-extension-0.1.0.zip` (12 entries, ~91KB)
- Clean of localhost, `.env`, secrets, tests, fixtures, `node_modules`, source maps
- Manifest permissions: `sidePanel`, `storage`; host_permissions only the packaging API origin
- Stable extension id (public key): `hkpcfcjmogoaakoemandjkkdgnhpdejk`

## Runtime E2E (local merged API + DB)

Against restarted API on integrated main + DEV DB `/pricetruth`:

- Valid observation -> analysis -> history: pass
- Insufficient-history analysis (`confidence.level = "INSUFFICIENT"`): pass
- Missing price rejected by API; client never posts ambiguous/no-price/identity failures: pass
- Stale navigation / generation protection: pass (`handler.test.ts`)
- Network failure classification: pass
- Live response bodies parse through extension validators: pass

Still manual:

- Unpacked Chrome side panel on live Amazon/Best Buy PDPs (CAPTCHA/throttling risk)

## Production / staging endpoint status

- `docs/STAGING_DEPLOYMENT.md`: **PLANNED** - no staging host provisioned
- Package gate requires non-empty HTTPS non-localhost `VITE_API_BASE_URL`
- Verified with placeholder `https://api-staging.pricetruth.example` only
- Do not hard-code a fake production URL in source

## Remaining issues

### P0

- None known in extension-owned code after local green runs.

### P1

- Real staging/production HTTPS origin still unpublished (blocks a real testers zip).
- `apps/api/test/migration.test.ts` cannot `CREATE DATABASE` in this environment (blocks claiming full monorepo `pnpm test` green here).
- Daytime manual Chrome PDP confirmation still required.

### P2

- Real-world matrix rows still placeholders.
- Optional Chrome fixture E2E harness can expand; CI stays unit/fixture based.

## PR posture

Keep PR #8 **draft** while any P1 remains. Do not merge from the agent.

## Do not merge order

Devin main is already merged. Cursor PR merges only after P1 clearance and reviewer approval.
