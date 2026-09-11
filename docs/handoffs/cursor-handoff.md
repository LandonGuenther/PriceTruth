# Cursor handoff - public beta extension (post-Devin integration)

## Original Cursor base SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

(`origin/main` when `cursor/public-beta-extension` started; short `5e9dd67`, same as Devin handoff base.)

## Integrated main SHA (backend merge)

`57c5059b4c780f6a48cc6684844205d6f64db4ef`

(Merge pull request #9 from LandonGuenther/devin/production-backend-beta)

## Extension beta merge SHA

`0973bc0655ee5a5cb32ddd5d40f9f904fa79a4fe`

(Merge pull request #8 from LandonGuenther/cursor/public-beta-extension into `main`)

## This handoff tip SHA

`PENDING_TIP` (branch tip)

## Branch

`cursor/beta-handoff-sync-c7e8` (follow-up docs sync after PR #8 merge)

Extension beta work originally landed on `cursor/public-beta-extension` and merged via PR #8.

## Owned / changed (extension beta)

- `apps/extension/**` - API client (`ApiRateLimitedError` / `retryAfterSeconds`, `x-request-id`, observation-schema version check, additive ingest fields, HTTPS package gate, pinned MV3 public `key`)
- `apps/api/test/security.test.ts` - allow Chrome public manifest `key` in secrets scan (false positive from the pin)
- `packages/retailer-adapters/**` - Cursor-owned; Amazon buy-box scoping already prevents cross-sell price adoption (`hidden-price-cross-sell` fixture)
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

## CODE STATUS: GREEN

Extension-owned correctness, packaging gates, and local Chrome fixture E2E against API+Postgres all pass. No known code blockers in Cursor-owned surfaces.

Re-verification 2026-09-11: Chrome fixture E2E `ALL_PASS` (11/11); `pnpm lint` / `typecheck` / `test` / `build` exit 0; package verify-package ok with HTTPS placeholder.

Amazon cross-sell contamination called out in the historical overnight audit is **mitigated in extension/adapters** (buy-box scoped extraction + fixtures/tests). Remaining beta blockers in that audit that are **backend/ops owned** are out of scope for this handoff.

## BETA RELEASE STATUS: BLOCKED (ops + live PDP)

Limited public beta is not release-ready until ops staging URL exists and live-retailer PDP validation is signed off. Missing staging URL is an ops/release blocker, not a code failure.

Extension preparation for beta (correctness, reliability, trust, packaging, handoff) is complete on the Cursor-owned surface.

## Test totals (re-run 2026-09-11)

| Suite | Result |
| --- | --- |
| Extension | **50** passed |
| Retailer adapters | **115** passed |
| Amazon fixtures | **23** (within adapters) |
| Best Buy fixtures | **15** (within adapters) |
| Shared / catalog / scoring | 17 / 16 / 39 passed |
| API | **132** passed (includes migration Path A/B) |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |
| `pnpm test` (full monorepo) | **pass** |

Note: full `pnpm test` truncates the DEV API database. Re-run fixture Chrome E2E after gates if DB evidence is needed.

## Package verification

- `VITE_API_BASE_URL=https://api-staging.pricetruth.example pnpm --filter @pricetruth/extension build && package && verify-package`
- Result: **ok** - `apps/extension/release/pricetruth-extension-0.1.0.zip` (12 entries)
- Permissions: `['sidePanel', 'storage']`; host_permissions: `['https://api-staging.pricetruth.example/*']`
- Clean of localhost, `.env`, secrets, tests, fixtures, `node_modules`, source maps
- Stable extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`

## Chrome unpacked fixture E2E (local API + Postgres) — PASS

Method: Chrome for Testing + puppeteer-core `pipe: true` + `Extensions.loadUnpacked` (branded Chrome 148 removed `--load-extension`; CDP loadUnpacked requires `--enable-unsafe-extension-debugging` + remote-debugging-pipe).

Fixture HTTPS on `:443` via setcap node; `--host-resolver-rules` maps amazon.com / bestbuy.com to `127.0.0.1`; `--ignore-certificate-errors`.

Extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`. Dist host_permissions for E2E: `http://127.0.0.1:3000/*`.

| Check | Result |
| --- | --- |
| Extension installs (loadUnpacked) | PASS |
| Side panel opens | PASS |
| Amazon fixture extracts + ingest + analysis | PASS |
| Best Buy fixture extracts + ingest + analysis | PASS |
| Side panel updates | PASS |
| Ambiguous price never POSTs | PASS |
| Nav Product A → B no stale A | PASS |

Artifacts (agent run): `/opt/cursor/artifacts/chrome-fixture-e2e-results.json`, panel ready/ambiguous screenshots, checklist video.

## Production / staging endpoint status

- `docs/STAGING_DEPLOYMENT.md`: **PLANNED** - no staging host provisioned
- Package gate requires HTTPS non-localhost `VITE_API_BASE_URL`
- Verified with placeholder `https://api-staging.pricetruth.example` only
- Do not hard-code a fake production URL

## Remaining issues (triaged)

### CODE BLOCKERS

- None known in extension-owned code after local Chrome fixture E2E + monorepo gates.

### RELEASE / OPERATIONS BLOCKERS

- Real staging/production HTTPS origin still unpublished (`docs/STAGING_DEPLOYMENT.md` = PLANNED). Blocks shipping a real testers zip (placeholder package only).
- Chrome Web Store / distribution / allowlist ops for pinned id `hkpcfcjmogoaakoemandjkkdgnhpdejk` still owner-side.
- Note: branded Google Chrome 148+ dropped `--load-extension`; automated load needs Chrome for Testing / Chromium, or CDP `Extensions.loadUnpacked` with `--enable-unsafe-extension-debugging`, or manual Load unpacked.

### MANUAL LIVE-RETAILER VALIDATION

- Live Amazon / Best Buy PDP confirmation on real retailer pages (CAPTCHA, layout drift, buy-box variants) still required before calling beta "field validated."
- Use `docs/BETA_EXTENSION_CHECKLIST.md` and `docs/EXTENSION_REAL_WORLD_TEST_MATRIX.md` for daytime passes.
- Real-world matrix rows remain placeholders until filled by humans.

## PR posture

- PR #8 (**merged** 2026-09-11): extension beta integration on `main`.
- This follow-up branch documents post-merge status only. Do not re-open beta code work unless new CODE BLOCKERS appear.
- Do not invent a staging URL or merge release/ops work from the agent.

## Owner next steps for limited public beta

1. Provision real staging HTTPS API and set `ALLOWED_EXTENSION_IDS=hkpcfcjmogoaakoemandjkkdgnhpdejk`.
2. Rebuild/package the extension with that origin; run `verify-package`.
3. Complete `docs/BETA_EXTENSION_CHECKLIST.md` on live Amazon/Best Buy PDPs.
4. Invite a small tester cohort only after (1)-(3).
