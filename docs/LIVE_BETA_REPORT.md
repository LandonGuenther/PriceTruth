# Live beta report

Status: **PARTIALLY LIVE** — Neon staging verified and exercised from this agent;
Fly.io app create is **blocked on billing** (payment method required on personal org).

## STATUS

| Area | State |
|------|-------|
| Repo bring-up (Devin) | Done on `devin/live-beta-bringup` |
| Cursor continuation branch | `cursor/live-beta-bringup` |
| Local gates | Green (373 tests; lint/typecheck/build re-verified) |
| Neon staging | **LIVE** — reachable, TLS, Postgres 16.15, 8 migrations applied |
| Fly API deploy | **BLOCKED** — `fly apps create` rejected: billing/payment required |
| Extension beta package | Blocked (needs public HTTPS Fly URL) |
| Real retailer data collection | Not active yet (only a controlled staging probe on Neon) |

## Base / tip commits

- Base (main merge point inherited by Devin): `git merge-base origin/main HEAD`
- Devin tip incorporated: `origin/devin/live-beta-bringup`
- Cursor tip: branch `cursor/live-beta-bringup` (this report tracks the branch HEAD)

## INFRASTRUCTURE

| Item | Value |
|------|-------|
| Fly app name | `pricetruth-api-staging` (intended; **not created** — billing gate) |
| Public HTTPS API URL | TBD after Fly billing + `fly deploy` |
| Fly region | `iad` (configured in `fly.toml`) |
| Fly machine size | `shared-cpu-1x` / 256 MB (configured) |
| Neon host (non-secret) | `ep-sparkling-paper-aukmmxhh-pooler.c-10.us-east-1.aws.neon.tech` |
| Neon database | `neondb` |
| Postgres version | **16.15** (verified via `SHOW server_version`) |
| Migrations | **8 applied**; `prisma migrate status` = Database schema is up to date |
| PITR / backup | Neon project retained; **RESTORE NOT YET TESTED** |

## NEON VERIFICATION (this session)

- `prisma migrate status`: Database schema is up to date (8 migrations)
- Harmless metadata query: OK
- Local API process bound to Neon: `GET /health` 200, `GET /readiness` 200 (`database=ok`, `migrations=ok`)
- Internal auth: unauthenticated/wrong token → 404; correct token → 200
- Controlled staging probe observation (`amazon` / `B0STAGETST`) written, then set to `EXCLUDED` so it does not affect scoring
- History + analysis endpoints returned successfully against Neon
- Rollup job: SUCCEEDED (1 listing-day recomputed)
- Archive job: SUCCEEDED (1 parquet batch under local archive dir)
- Observation count after probe exclude: 1 row (`EXCLUDED`); listings=1; retailers=1

## ARCHIVE

| Item | Value |
|------|-------|
| Mode | `local` (verified via job against Neon; Fly volume not mounted yet) |
| Fly volume | `pricetruth_archive` → `/data` (1 GB) — pending app create |
| R2 | Next infrastructure upgrade (prior Cloudflare token invalid) |

## JOBS

| Job | Schedule (intended) | Status |
|-----|---------------------|--------|
| Rollup | Daily 06:12 UTC via `staging-jobs.yml` | Code OK; ran successfully against Neon from agent |
| Archive | Daily 07:12 UTC | Code OK; ran successfully against Neon from agent |
| Best Buy refresh | Every 6h at :42 | Code ready; `BESTBUY_API_KEY` not configured |
| Staging canary | Every 6h at :17 | Workflow ready; needs public `STAGING_API_URL` after Fly deploy |

## EXTENSION

| Item | Value |
|------|-------|
| Version | `0.1.0` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Beta artifact | TBD (`pricetruth-extension-0.1.0.zip` after real HTTPS API URL build) |
| SHA-256 | TBD |
| API URL baked in | TBD (must be HTTPS staging; no localhost) |

## DATA

| Item | Value |
|------|-------|
| First legitimate retailer observation | Not yet (no live extension → public API path) |
| Staging probe | `amazon` / `B0STAGETST` written then `EXCLUDED` |
| Current observation count | 1 (excluded probe) |
| Listing count | 1 |
| Retailers represented | amazon (probe only) |

## LIVE VALIDATION

| Retailer | Result |
|----------|--------|
| Best Buy | Not run (no public API yet) |
| Amazon | Not run (no public API yet) |

## TESTS (this session)

| Check | Result |
|-------|--------|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 373 passed |
| `pnpm build` | pass |
| Neon migrate status | pass |
| Local API `/health` + `/readiness` vs Neon | pass |
| Internal auth | pass |
| Observation → Neon → history/analysis | pass |
| Rollup + archive jobs vs Neon | pass |
| Public Fly HTTPS | **blocked on billing** |
| Extension → staging E2E | not run |
| Restart/persistence on Fly | not run |

## COST (planned)

See `docs/COSTS.md`. Target monthly baseline well under $25 (small Fly VM + existing Neon).
Fly create is currently refused until a payment method exists on the personal org.

## CREDENTIAL POLICY (solo / pre-company)

- `BESTBUY_API_KEY`: **not required** for beta launch.
- `INTERNAL_API_TOKEN`: generated at deploy time; store in Fly secrets + password manager only.
- **Security note:** Fly + Neon credentials were pasted into chat for this session. **Rotate both after deploy** (Fly token revoke/recreate; Neon password reset). Prefer Cursor secure secrets going forward.

## OWNER ACTIONS (unavoidable)

1. **Add Fly.io billing** on org `landonguenther00-gmail-com`: https://fly.io/dashboard/landonguenther00-gmail-com/billing then reply here so deploy can resume.
2. **Rotate** the Fly API token and Neon DB password that were pasted into chat.
3. After Fly deploy: set GitHub Actions secrets `STAGING_API_URL`, `STAGING_INTERNAL_API_TOKEN`, `FLY_API_TOKEN`.
4. Optional: `BESTBUY_API_KEY` for official known-listing refresh.
5. Install beta ZIP and manually confirm Amazon/Best Buy PDPs if the cloud browser cannot show live prices.

## NEXT STEPS (agent, once Fly billing is active)

1. `fly apps create pricetruth-api-staging` + volume + secrets + `./scripts/deploy-staging.sh`
2. Public `/health` + `/readiness` over HTTPS
3. Rebuild extension with real HTTPS API URL; package + verify (no localhost)
4. Browser E2E + polite live retailer checks
5. Wire canary/jobs to public URL; restart persistence test
6. Finalize this report with the live URL
