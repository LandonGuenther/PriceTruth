# Cursor handoff - public beta extension (post-Devin integration)

## Original Cursor base SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

(`origin/main` when `cursor/public-beta-extension` started; short `5e9dd67`, same as Devin handoff base.)

## New integrated main SHA

`57c5059b4c780f6a48cc6684844205d6f64db4ef`

(Merge pull request #9 from LandonGuenther/devin/production-backend-beta)

## New Cursor head SHA

`84edf22efadd4839770cfafb2210af9ac94da174` (branch tip)
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

## CODE STATUS: GREEN

Extension-owned correctness, packaging gates, and local Chrome fixture E2E against API+Postgres all pass. No known code blockers in Cursor-owned surfaces.

Fresh re-verification 2026-09-11 (this agent turn): Chrome fixture E2E `ALL_PASS` (11/11); `pnpm lint` / `typecheck` / `test` / `build` exit 0.

## BETA RELEASE STATUS: BLOCKED

Limited public beta is not release-ready until ops staging URL exists and live-retailer PDP validation is signed off. Missing staging URL is an ops/release blocker, not a code failure.

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

Note: full `pnpm test` truncates the DEV API database. Re-run fixture Chrome E2E after gates if DB evidence is needed. Chrome E2E in this turn was run **before** the gate re-run and passed.

## Package verification

- `VITE_API_BASE_URL=https://api-staging.pricetruth.example pnpm --filter @pricetruth/extension build && package && verify-package`
- Result: **ok** - `apps/extension/release/pricetruth-extension-0.1.0.zip`
- Permissions: `['sidePanel', 'storage']`; host_permissions: `['https://api-staging.pricetruth.example/*']`
- Clean of localhost, `.env`, secrets, tests, fixtures, `node_modules`, source maps
- Stable extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`

## Chrome unpacked fixture E2E (local API + Postgres) — PASS

Method: Chrome for Testing + puppeteer-core `pipe: true` + `Extensions.loadUnpacked` (branded Chrome 148 removed `--load-extension`; CDP loadUnpacked requires `--enable-unsafe-extension-debugging` + remote-debugging-pipe).

Fixture HTTPS on `:443` via setcap node; `--host-resolver-rules` maps amazon.com / bestbuy.com to `127.0.0.1`; `--ignore-certificate-errors`.

Extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`. Dist host_permissions for E2E: `http://127.0.0.1:3000/*`.

Checklist (re-run 2026-09-11, `/opt/cursor/artifacts/chrome-fixture-e2e-results.json`):

| Check | Result |
| --- | --- |
| Extension installs (loadUnpacked) | PASS |
| Side panel opens | PASS |
| Amazon fixture `B0DEMOASIN` extracts | PASS (`Acme Demo Widget 3000`) |
| Best Buy fixture `6418599` extracts | PASS (`Acme 55" TV`) |
| Observation reaches API/DB | PASS (amazon + bestbuy ingest counts > 0) |
| Analysis returns | PASS (`confidence=INSUFFICIENT`, deal score present on amazon) |
| Side panel updates | PASS (tab state `ready` / `B0DEMOASIN`) |
| Ambiguous `B0AMBIGPR1` never POSTs | PASS (DB count 0; panel status `ambiguous`) |
| Nav Product A → B no stale A | PASS (tab state `B0TYPICALX` ready; not showing `B0DEMOASIN`) |

Artifacts:

- `/opt/cursor/artifacts/chrome-fixture-e2e-results.json` (`ALL_PASS`)
- `/opt/cursor/artifacts/e2e_sidepanel_after_amazon.png`
- `/opt/cursor/artifacts/e2e_sidepanel_after_bestbuy.png`
- `/opt/cursor/artifacts/e2e_sidepanel_ambiguous.png`
- `/opt/cursor/artifacts/e2e_sidepanel_after_product_b.png`
- `/opt/cursor/artifacts/chrome_fixture_e2e_full_checklist.mp4` (prior full checklist recording)
- `/opt/cursor/artifacts/repo-gates-rerun.log`

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
- Real-world matrix rows remain placeholders.

## PR posture

Keep PR #8 **draft** while RELEASE/OPS + MANUAL LIVE-RETAILER items remain. Do not merge from the agent.

## Do not merge order

Do not merge until CODE stays green and RELEASE/OPS + MANUAL LIVE-RETAILER are cleared by the owner.
