# Live beta report

Status: **PARTIALLY LIVE** — public Fly API is up against Neon; extension beta ZIP is built;
awaiting owner GitHub secrets + first real retailer PDP validation in Chrome.

## STATUS

| Area                          | State                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Repo bring-up (Devin)         | Done on `devin/live-beta-bringup`                                                                                         |
| Cursor continuation branch    | `cursor/live-beta-bringup`                                                                                                |
| Local gates                   | Green (373 tests prior; rollup timeout fix added)                                                                         |
| Neon staging                  | **LIVE** — Postgres 16.15, 8 migrations applied; INTERNAL_API_TOKEN rotated, DATABASE_URL on direct endpoint (2026-09-18) |
| Fly API deploy                | **LIVE** at https://pricetruth-api-staging.fly.dev                                                                        |
| Scheduled jobs                | **LIVE** — Fly scheduled Machines (rollup hourly / archive daily / bestbuy-refresh daily)                                 |
| Extension beta package        | **READY** (HTTPS staging URL baked in; no localhost)                                                                      |
| Real retailer data collection | Not yet from live PDPs (controlled probes only)                                                                           |

## Base / tip commits

- Devin tip incorporated: `origin/devin/live-beta-bringup`
- Cursor tip: branch `cursor/live-beta-bringup` (includes rollup tx timeout fix)

## INFRASTRUCTURE

| Item                   | Value                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Fly app name           | `pricetruth-api-staging`                                                             |
| Public HTTPS API URL   | https://pricetruth-api-staging.fly.dev                                               |
| Fly region             | `iad`                                                                                |
| Fly machine size       | `shared-cpu-1x` / 256 MB                                                             |
| Fly IPs                | shared IPv4 + dedicated IPv6                                                         |
| Neon host (non-secret) | `ep-sparkling-paper-aukmmxhh-pooler.c-10.us-east-1.aws.neon.tech`                    |
| Neon database          | `neondb`                                                                             |
| Postgres version       | **16.15**                                                                            |
| Migrations             | **8 applied**; release_command migrate deploy OK                                     |
| PITR / backup          | **VERIFIED** — Neon PITR branch restore tested 2026-09-18 (window: 6 h on free plan) |

## ARCHIVE

| Item     | Value                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode     | `local` on Fly volumes                                                                                                                                                                                                     |
| Volumes  | `pricetruth_archive` → `/data` on the API machine (batches 1–4, 2026-09-11); `pricetruth_archive_jobs` → `/data` on the archive job machine (batches 5+, 1 GB) — split is historical, dedup only reads the writer's volume |
| Verified | Job run 2026-09-18 00:24Z: "5 batch(es) (9 rows exported, 0 skipped) → /data/archive"                                                                                                                                      |
| R2       | Next infrastructure upgrade — **owner action** (available Cloudflare token is invalid)                                                                                                                                     |

## JOBS

Jobs are Fly scheduled Machines in `pricetruth-api-staging` (256 MB,
`autostart=false`, `fly_process_group=jobs`, WORKDIR `/app/apps/api`),
managed by `scripts/fly-schedule-jobs.sh`. Fly schedules are relative to
machine creation (~00:22Z/00:24Z UTC). `staging-jobs.yml` is now a
`workflow_dispatch` manual fallback only.

| Machine                      | Schedule     | Command                                                          | First run                                                                                    |
| ---------------------------- | ------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pricetruth-rollup`          | hourly       | `pnpm jobs rollup`                                               | 2026-09-18 00:23Z — "8 listing-day(s) recomputed (9 observations, 11 status events scanned)" |
| `pricetruth-archive`         | daily        | `pnpm jobs archive`                                              | 00:24Z — "5 batch(es) (9 rows exported, 0 skipped) → /data/archive"                          |
| `pricetruth-bestbuy-refresh` | daily        | `pnpm jobs bestbuy-refresh --min-age-hours 6 --max-listings 200` | ran — "disabled (BESTBUY_API_KEY not set)"; activates when the key is a Fly secret           |
| `staging-canary` (Actions)   | every 6h :17 | /health + /readiness + status                                    | **dormant** — GitHub secrets could not be set (no permission); owner action                  |

## EXTENSION

| Item                 | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| Version              | `0.1.0`                                                              |
| Extension ID         | `hkpcfcjmogoaakoemandjkkdgnhpdejk`                                   |
| Beta artifact        | `apps/extension/release/pricetruth-extension-0.1.0.zip` (gitignored) |
| SHA-256              | `030eb7d5a52cc136be5aec5e4708d62424691257b6ecaf0834cbd8cb6967cca0`   |
| API URL baked in     | `https://pricetruth-api-staging.fly.dev`                             |
| Localhost in package | **None** (verify-package passed)                                     |

## DATA

<!-- LIVE-VALIDATION-PENDING -->

| Item                                      | Value                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First legitimate retailer PDP observation | Not yet                                                                                                                                                                    |
| Controlled DQ probe                       | ASIN `B0PTDQTEST` — 3 prices ~50000¢ ACCEPTED, one 500¢ QUARANTINED at ingest and excluded from analysis (see `/home/ubuntu/dq-live-test.md` for request/response capture) |
| Staging probes                            | 2 amazon probe ASINs, `EXCLUDED`                                                                                                                                           |
| Observations                              | 13 (as of 2026-09-16T22:59Z: ACCEPTED 7, CORROBORATED 2, EXCLUDED 4)                                                                                                       |
| Listings                                  | 11                                                                                                                                                                         |
| Retailers                                 | 2                                                                                                                                                                          |

## LIVE VALIDATION

| Check                                       | Result                                                  |
| ------------------------------------------- | ------------------------------------------------------- |
| Public `/health`                            | 200                                                     |
| Public `/readiness`                         | 200 (`database=ok`, `migrations=ok`)                    |
| Internal auth deny/allow                    | 404 unauth/wrong; 200 with token                        |
| HTTPS observation → Neon → history/analysis | Pass (probe then EXCLUDED)                              |
| Rollup on Fly                               | Pass (scheduled machine, 8 listing-days recomputed)     |
| Archive on Fly volume                       | Pass (5 batches via `pricetruth_archive_jobs`)          |
| Machine restart persistence                 | Pass (counts unchanged; volume intact)                  |
| Neon PITR restore                           | Pass (branch queried, matched live, deleted)            |
| Anomaly quarantine end-to-end               | Pass (500¢ probe → QUARANTINED, excluded from analysis) |
| Best Buy live PDP                           | <!-- LIVE-VALIDATION-PENDING -->                        |
| Amazon live PDP                             | <!-- LIVE-VALIDATION-PENDING --> (owner Chrome install) |

## TESTS

| Check                           | Result                                |
| ------------------------------- | ------------------------------------- |
| Local lint/typecheck/test/build | Pass (373 tests earlier this session) |
| Public Fly HTTPS                | Pass                                  |
| Extension package verify        | Pass                                  |

## COST

| Item                              | Estimate                  |
| --------------------------------- | ------------------------- |
| Fly shared-cpu-1x 256MB always-on | ~$2.02/mo                 |
| Fly 1GB volume                    | ~$0.15/mo                 |
| Shared IPv4                       | $0                        |
| Neon existing project             | usually $0 on free/launch |
| **Typical monthly baseline**      | **~$2–5**                 |

## OWNER ACTIONS

1. ~~Rotate Fly API token + Neon DB password~~ done 2026-09-18 (INTERNAL_API_TOKEN rotated; DATABASE_URL → Neon direct endpoint).
2. Set GitHub Actions secrets (could not be set by agents — no repo permission):
   - `STAGING_API_URL=https://pricetruth-api-staging.fly.dev`
   - `STAGING_INTERNAL_API_TOKEN=<same value as Fly INTERNAL_API_TOKEN>`
   - `FLY_API_TOKEN=<rotated token>`
3. Load `pricetruth-extension-0.1.0.zip` unpacked in Chrome and visit an Amazon/Best Buy PDP.
4. `BESTBUY_API_KEY` as a Fly secret → `pricetruth-bestbuy-refresh` starts collecting.
5. R2 archive upgrade — the available Cloudflare token is invalid; needs a valid token to proceed.

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
