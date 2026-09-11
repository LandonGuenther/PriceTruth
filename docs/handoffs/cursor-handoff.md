# Cursor handoff - public beta extension (post-Devin integration)

## Original Cursor base SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

(`origin/main` when `cursor/public-beta-extension` started; short `5e9dd67`, same as Devin handoff base.)

## New integrated main SHA

`57c5059b4c780f6a48cc6684844205d6f64db4ef`

(Merge pull request #9 from LandonGuenther/devin/production-backend-beta)

## New Cursor head SHA

`79426831a90cbf602a749a5c0abd844e433b5dd6` (branch tip)

## Branch

`cursor/public-beta-extension`

Rebased onto `57c5059b4c780f6a48cc6684844205d6f64db4ef`. **Conflicts: none** (clean rebase).

## Owned / changed

- `apps/extension/**` - API client (`ApiRateLimitedError` / `retryAfterSeconds`, `x-request-id`, observation-schema version check, additive ingest fields, HTTPS package gate, pinned MV3 public `key`)
- `apps/api/test/security.test.ts` - allow Chrome public manifest `key` in secrets scan (false positive from the pin)
- `packages/retailer-adapters/**` - unchanged this turn; still Cursor-owned
- Extension docs + this handoff

## Devin API changes integrated

- Response headers: `x-pricetruth-api-version`, `x-pricetruth-observation-schema-version`, `x-request-id`
- Success bodies add `apiVersion: 1`
- Ops routes: `GET /health`, `GET /readiness`
- 429 body `{ error: "rate_limited", message, retryAfterSeconds }` → `ApiRateLimitedError` (no auto-retry)
- Ingest additive: `status`, `enrichment`, `apiVersion`
- CORS allow-list (`ALLOWED_EXTENSION_IDS`) ready for pinned id `hkpcfcjmogoaakoemandjkkdgnhpdejk`
- Shared types: no breaking changes

## Observation payload

Confident extraction only. Fields: `retailer`, `externalId`, `url`, `title`, optional brand/model/gtin, `priceCents`, optional reference + type, `currency`, optional stock/variant, `source`, `observedAt`, `schemaVersion`, `priceType`, `extractorVersion`.

Client version via `x-pricetruth-client-version`. No fabricated confidence/trust/quarantine.

## Data quality

`not_product_page`, `no_identifier`, `no_price`, `ambiguous_price`, `invalid` never call `POST /v1/observations`.
Backend owns trust/quarantine; extension owns safe extraction.

## Test totals (re-verified after CREATEDB grant)

| Suite | Result |
| --- | --- |
| Extension | **50** passed |
| Retailer adapters | **115** passed |
| Amazon fixtures | **23** |
| Best Buy fixtures | **15** |
| Shared / catalog / scoring | 17 / 16 / 39 passed |
| API | **132** passed (includes migration Path A/B) |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |
| `pnpm test` (full monorepo) | **pass** |

## Package verification

- `VITE_API_BASE_URL=https://api-staging.pricetruth.example pnpm --filter @pricetruth/extension build && package && verify-package`
- Result: **ok** - `apps/extension/release/pricetruth-extension-0.1.0.zip` (12 entries, 90783 bytes)
- Permissions: `['sidePanel', 'storage']`; host_permissions: `['https://api-staging.pricetruth.example/*']`
- Clean of localhost, `.env`, secrets, tests, fixtures, `node_modules`, source maps
- Stable extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`

## Runtime E2E

Local merged API + DB:

- Valid observation → analysis → history: pass
- Insufficient history (`confidence.level = "INSUFFICIENT"`): pass
- Ambiguous/no-price never ingest (handler + API): pass
- Stale navigation protection: pass
- Live bodies parse through extension validators: pass

Chrome unpacked load: headless screenshot of `chrome-extension://` side panel returned `ERR_BLOCKED_BY_CLIENT` (headless extension limitation). Live Amazon/Best Buy PDP side-panel confirmation remains a manual daytime pass.

## Production / staging endpoint status

- `docs/STAGING_DEPLOYMENT.md`: **PLANNED** - no staging host provisioned
- Package gate requires HTTPS non-localhost `VITE_API_BASE_URL`
- Verified with placeholder `https://api-staging.pricetruth.example` only
- Do not hard-code a fake production URL

## Remaining issues

### P0

- None known in extension-owned code.

### P1

- Real staging/production HTTPS origin still unpublished (blocks a real testers zip).
- Manual Chrome PDP confirmation on live Amazon/Best Buy still required.

### P2

- Real-world matrix rows still placeholders.
- Optional Chrome fixture E2E harness can expand; CI stays unit/fixture based.

## PR posture

Keep PR #8 **draft** while P1 remains (staging URL + manual PDP). Do not merge from the agent.

## Do not merge order

Devin main already merged. Cursor PR merges after P1 clearance and reviewer approval.
