# Live beta report

Status: **PARTIALLY LIVE** — public Fly API is up against Neon; extension beta ZIP is built;
awaiting owner GitHub secrets + first real retailer PDP validation in Chrome.

## STATUS

| Area | State |
|------|-------|
| Repo bring-up (Devin) | Done on `devin/live-beta-bringup` |
| Cursor continuation branch | `cursor/live-beta-bringup` |
| Local gates | Green (373 tests prior; rollup timeout fix added) |
| Neon staging | **LIVE** — Postgres 16.15, 8 migrations applied |
| Fly API deploy | **LIVE** at https://pricetruth-api-staging.fly.dev |
| Extension beta package | **READY** (HTTPS staging URL baked in; no localhost) |
| Real retailer data collection | Not yet from live PDPs (controlled probes only, EXCLUDED) |

## Base / tip commits

- Devin tip incorporated: `origin/devin/live-beta-bringup`
- Cursor tip: branch `cursor/live-beta-bringup` (includes rollup tx timeout fix)

## INFRASTRUCTURE

| Item | Value |
|------|-------|
| Fly app name | `pricetruth-api-staging` |
| Public HTTPS API URL | https://pricetruth-api-staging.fly.dev |
| Fly region | `iad` |
| Fly machine size | `shared-cpu-1x` / 256 MB |
| Fly IPs | shared IPv4 + dedicated IPv6 |
| Neon host (non-secret) | `ep-sparkling-paper-aukmmxhh-pooler.c-10.us-east-1.aws.neon.tech` |
| Neon database | `neondb` |
| Postgres version | **16.15** |
| Migrations | **8 applied**; release_command migrate deploy OK |
| PITR / backup | Neon retained; **RESTORE NOT YET TESTED** |

## ARCHIVE

| Item | Value |
|------|-------|
| Mode | `local` on Fly volume |
| Volume | `pricetruth_archive` → `/data` (1 GB, encrypted) |
| Verified | Archive job wrote `schema=v1/...` under `/data/archive`; survived machine restart |
| R2 | Next infrastructure upgrade |

## JOBS

| Job | Schedule (intended) | Status |
|-----|---------------------|--------|
| Rollup | Daily 06:12 UTC via `staging-jobs.yml` | Ran successfully on Fly machine |
| Archive | Daily 07:12 UTC | Ran successfully on Fly machine |
| Best Buy refresh | Every 6h at :42 | Code ready; `BESTBUY_API_KEY` not configured |
| Staging canary | Every 6h at :17 | Workflow ready; needs GitHub `STAGING_API_URL` |

## EXTENSION

| Item | Value |
|------|-------|
| Version | `0.1.3` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Beta artifact | `apps/extension/release/pricetruth-extension-0.1.3.zip` (gitignored) |
| SHA-256 | `1aab09007fc7a6c3f5c9ac39f5292e6f89a3ccfe54fe2ef2beac67a9be52a675` |
| API URL baked in | `https://pricetruth-api-staging.fly.dev` |
| Localhost in package | **None** (verify-package passed) |

## DATA

| Item | Value |
|------|-------|
| First legitimate retailer PDP observation | Not yet |
| Staging probes | 2 amazon probe ASINs, both `EXCLUDED` from scoring |
| Observation count | 2 |
| Listing count | 2 |
| Retailers represented | amazon (probes only) |

## LIVE VALIDATION

| Check | Result |
|-------|--------|
| Public `/health` | 200 |
| Public `/readiness` | 200 (`database=ok`, `migrations=ok`) |
| Internal auth deny/allow | 404 unauth/wrong; 200 with token |
| HTTPS observation → Neon → history/analysis | Pass (probe then EXCLUDED) |
| Rollup on Fly | Pass |
| Archive on Fly volume | Pass |
| Machine restart persistence | Pass (counts unchanged; volume intact) |
| Best Buy live PDP | Not run in this agent |
| Amazon live PDP | Not run in this agent (owner Chrome install) |

## TESTS

| Check | Result |
|-------|--------|
| Local lint/typecheck/test/build | Pass (373 tests earlier this session) |
| Public Fly HTTPS | Pass |
| Extension package verify | Pass |

## COST

| Item | Estimate |
|------|----------|
| Fly shared-cpu-1x 256MB always-on | ~$2.02/mo |
| Fly 1GB volume | ~$0.15/mo |
| Shared IPv4 | $0 |
| Neon existing project | usually $0 on free/launch |
| **Typical monthly baseline** | **~$2–5** |

## OWNER ACTIONS

1. **Rotate** Fly API token + Neon DB password (pasted into chat earlier).
2. Set GitHub Actions secrets:
   - `STAGING_API_URL=https://pricetruth-api-staging.fly.dev`
   - `STAGING_INTERNAL_API_TOKEN=<same value as Fly INTERNAL_API_TOKEN>`
   - `FLY_API_TOKEN=<rotated token>`
3. Load the rebuilt `pricetruth-extension-0.1.3.zip` unpacked (remove any older copy first). Chrome/Edge: side panel. Opera: toolbar popup UI. Expect a light, verdict-first panel (not the old dark dashboard). Visit an Amazon/Best Buy PDP.
4. Optional: `BESTBUY_API_KEY` for official known-listing refresh.

## HOW DO I KNOW IT IS DOWN?

1. `curl https://pricetruth-api-staging.fly.dev/health` non-200
2. `curl https://pricetruth-api-staging.fly.dev/readiness` non-200
3. `fly status -a pricetruth-api-staging` / `fly logs -a pricetruth-api-staging`
4. GitHub Action `staging-canary` (once secrets set)
5. Neon dashboard project health

## NEXT STEPS

1. Owner Chrome install + first real PDP observation
2. Wire GitHub canary/job secrets
3. Optional Best Buy API key
4. R2 archive upgrade later
5. Invite 5–10 beta testers after one successful real PDP round-trip
