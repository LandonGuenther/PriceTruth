# Cursor handoff - public beta extension (post-Devin integration)

## Original Cursor base SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

(`origin/main` when `cursor/public-beta-extension` started; short `5e9dd67`, same as Devin handoff base.)

## New integrated main SHA

`57c5059b4c780f6a48cc6684844205d6f64db4ef`

(Merge pull request #9 from LandonGuenther/devin/production-backend-beta)

## New Cursor head SHA

`8a9d2267cb33aa716091c4f0aa2ce66ff00e313b` (branch tip; update again after this commit)

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

## BETA RELEASE STATUS: BLOCKED

Limited public beta is not release-ready until ops staging URL exists and live-retailer PDP validation is signed off. Missing staging URL is an ops/release blocker, not a code failure.

## Test totals (re-run 2026-09-11)

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

Note: full `pnpm test` truncates the DEV API database. Re-run fixture Chrome E2E after gates if DB evidence is needed.

## Package verification

- `VITE_API_BASE_URL=https://api-staging.pricetruth.example pnpm --filter @pricetruth/extension build && package && verify-package`
- Result: **ok** - `apps/extension/release/pricetruth-extension-0.1.0.zip` (12 entries, 90783 bytes)
- Permissions: `['sidePanel', 'storage']`; host_permissions: `['https://api-staging.pricetruth.example/*']`
- Clean of localhost, `.env`, secrets, tests, fixtures, `node_modules`, source maps
- Stable extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`

## Chrome unpacked fixture E2E (local API + Postgres) — PASS

Method: Chrome for Testing 153 + puppeteer-core `pipe: true` + `Extensions.loadUnpacked` (branded Chrome 148 removed `--load-extension`; CDP loadUnpacked requires `--enable-unsafe-extension-debugging` + remote-debugging-pipe).

Fixture HTTPS on `:443` via setcap node; `--host-resolver-rules` maps amazon.com / bestbuy.com to `127.0.0.1`; `--ignore-certificate-errors`.

Extension id: `hkpcfcjmogoaakoemandjkkdgnhpdejk`. Dist host_permissions: `http://127.0.0.1:3000/*`.

Checklist:

| Check | Result |
| --- | --- |
| Extension installs (loadUnpacked) | PASS |
| Side panel opens | PASS |
| Amazon fixture `B0DEMOASIN` extracts ($299 / list $499) | PASS |
| Best Buy fixture `6418599` extracts ($279.99 / was $399.99) | PASS |
| Observation reaches API/DB | PASS (amazon 29900, bestbuy 27999, B0TYPICALX 4499) |
| Analysis returns | PASS (`confidence.level=INSUFFICIENT`, dealScore present) |
| Side panel updates | PASS (ready states for A/BB/B; ambiguous UI) |
| Ambiguous `B0AMBIGPR1` never POSTs | PASS (DB count stayed 0; panel: nothing recorded) |
| Nav Product A → B no stale A | PASS (tab state `B0TYPICALX` ready; not showing `B0DEMOASIN`) |

Artifacts (agent run):

- `/opt/cursor/artifacts/chrome-fixture-e2e-results.json` (`ALL_PASS`)
- `/opt/cursor/artifacts/e2e-db-evidence.txt`
- `/opt/cursor/artifacts/panel_amazon_ready.png`
- `/opt/cursor/artifacts/panel_bestbuy_ready.png`
- `/opt/cursor/artifacts/panel_ambiguous.png`
- `/opt/cursor/artifacts/panel_product_b_ready.png`
- `/opt/cursor/artifacts/chrome_fixture_e2e_full_checklist.mp4`
- `/opt/cursor/artifacts/sidepanel_amazon_bestbuy_ready_states.mp4`
- `/opt/cursor/artifacts/repo-gates.log`

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

`gh` cannot update PR bodies in this environment (read-only integration). Handoff in-repo is the durable status record; parent agent should refresh PR #8 summary from this file if ManagePullRequest is available.

## Do not merge order

Devin main already merged. Cursor PR merges after release/ops staging URL + live PDP sign-off and reviewer approval.
