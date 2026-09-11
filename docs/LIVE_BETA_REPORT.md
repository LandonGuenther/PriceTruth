# Live beta report

Status: **BLOCKED ON SECRETS** (repo + local gates ready; waiting on secure injection of
`FLY_API_TOKEN` + Neon `DATABASE_URL` into the Cloud Agent environment)

## STATUS

| Area | State |
|------|-------|
| Repo bring-up (Devin) | Done on `devin/live-beta-bringup` |
| Cursor continuation branch | `cursor/live-beta-bringup` |
| Local gates | Green (373 tests; lint/typecheck/build re-verified) |
| Neon staging | Not re-verified in this agent (no `DATABASE_URL` / `NEON_API_KEY`) |
| Fly API deploy | Blocked (`FLY_API_TOKEN` missing) |
| Extension beta package | Blocked (needs real HTTPS API URL) |
| Real data collection | Not active yet |

## Base / tip commits

- Base (main merge point inherited by Devin): see `git merge-base origin/main HEAD`
- Devin tip incorporated: `origin/devin/live-beta-bringup`
- Cursor tip: branch `cursor/live-beta-bringup` (this report tracks the branch HEAD)

## INFRASTRUCTURE

| Item | Value |
|------|-------|
| Fly app name | `pricetruth-api-staging` (intended; not created yet) |
| Public HTTPS API URL | TBD after `fly deploy` |
| Fly region | `iad` |
| Fly machine size | `shared-cpu-1x` / 256 MB |
| Neon project | `pricetruth-staging` (existing; not re-verified here) |
| Postgres version | Expected 16 (unverified this session) |
| PITR / backup | Expected configured on Neon; **RESTORE NOT YET TESTED** |

## ARCHIVE

| Item | Value |
|------|-------|
| Mode | `local` on Fly volume (intended) |
| Volume | `pricetruth_archive` → `/data` (1 GB) |
| R2 | Next infrastructure upgrade (prior Cloudflare token invalid) |

## JOBS

| Job | Schedule (intended) | Status |
|-----|---------------------|--------|
| Rollup | Daily 06:12 UTC via `staging-jobs.yml` | Workflow ready; needs `FLY_API_TOKEN` GitHub secret |
| Archive | Daily 07:12 UTC | Same |
| Best Buy refresh | Every 6h at :42 | Code ready; needs `BESTBUY_API_KEY` + Fly/GitHub token |
| Staging canary | Every 6h at :17 | Workflow ready; needs `STAGING_API_URL` (+ optional internal token) |

## EXTENSION

| Item | Value |
|------|-------|
| Version | `0.1.0` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Beta artifact | TBD (`pricetruth-extension-0.1.0.zip` after real API URL build) |
| SHA-256 | TBD |
| API URL baked in | TBD (must be HTTPS staging; no localhost) |

## DATA

No legitimate retailer observations written from this agent session yet (API not deployed).

## LIVE VALIDATION

| Retailer | Result |
|----------|--------|
| Best Buy | Not run (no live API) |
| Amazon | Not run (no live API) |

## TESTS (local, this session)

| Check | Result |
|-------|--------|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 373 passed |
| `pnpm build` | pass |
| Public health/readiness | not run |
| Extension → staging E2E | not run |
| Restart/persistence | not run |

## COST (planned, not billed yet)

See `docs/COSTS.md`. Target monthly baseline well under $25 (small Fly VM + existing Neon).

## CREDENTIAL POLICY (solo / pre-company)

- `BESTBUY_API_KEY`: **not required** for beta launch. Official Best Buy API refresh stays `NOT CONFIGURED` until a personal/company Best Buy developer key exists. Browser-extension Best Buy observations still work later without it.
- `INTERNAL_API_TOKEN`: **not required from owner**. Generated securely at deploy time and stored only in Fly secrets (never committed).
- Required for deploy: `FLY_API_TOKEN` + `DATABASE_URL` (personal Fly + existing Neon project are enough).

## OWNER ACTIONS (unavoidable)

1. Provide Cursor secure secrets: `FLY_API_TOKEN`, `DATABASE_URL` (or `NEON_API_KEY`).
2. Optional: `BESTBUY_API_KEY`, `INTERNAL_API_TOKEN`.
3. After deploy: set GitHub Actions secrets `STAGING_API_URL`, `STAGING_INTERNAL_API_TOKEN`, `FLY_API_TOKEN`.
4. Install beta ZIP and manually confirm Amazon/Best Buy PDPs if the cloud browser cannot show live prices.

## NEXT STEPS (agent, once secrets arrive)

1. Verify Neon connectivity + `prisma migrate status`
2. `fly apps create` / secrets / deploy
3. Public health + readiness
4. Auth checks on `/internal/*`
5. Controlled observation write + history/analysis
6. Build/package extension against real HTTPS URL
7. Browser E2E + polite live retailer checks
8. Jobs + canary + rollup + archive
9. Restart persistence test
10. Finalize this report with real values
