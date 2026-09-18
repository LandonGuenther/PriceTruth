# Live beta report

Status: **LIVE, VALIDATED** — public Fly API (`5859aae`) is up against Neon; extension beta ZIP
rebuilt at adapter 1.2.1; live Chrome fixture + real-PDP validation done (hidden-price env only).
No legitimate real observations yet; awaiting owner visible-price + Best Buy PDP checks.

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

| Item                 | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Version              | `0.1.0` (adapter `1.2.1`)                                                                      |
| Extension ID         | `hkpcfcjmogoaakoemandjkkdgnhpdejk`                                                             |
| Beta artifact        | `apps/extension/release/pricetruth-extension-0.1.0.zip` (gitignored; 12 entries, 90,979 bytes) |
| SHA-256              | `d7c15fedcea78e487fb47f8b95958e837402401e317ce623fcf0537bbd64b077`                             |
| API URL baked in     | `https://pricetruth-api-staging.fly.dev`                                                       |
| Localhost in package | **None** (verify-package passed)                                                               |
| Deployed API SHA     | `5859aae` (readiness 200: database ok, migrations ok); doc tip = `5859aae` + docs commit       |

## DATA

| Item                                      | Value                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First legitimate retailer PDP observation | **NONE yet** — every live row is fixture/synthetic/excluded. Retailers collect (Amazon + Best Buy via extension) only once the owner/testers install the zip                                                  |
| Fixture-validated observations            | Amazon sale `B0PTLIVE01` 29900/49900; Best Buy `99189999` 27999/39999; unchanged revisit → duplicate (original row kept); changed price → new row (obs 20 → 23)                                               |
| Real Amazon PDPs tested                   | 4 (`B00MNV8E0C`, `0735211299`, `B00000JHQ6`, `B09XS7JWHH`) — all hid the buy-box price in the test environment → extension correctly POSTed nothing                                                           |
| Defect 1 (fixed)                          | Adapter 1.2.0 ingested a hidden SnS tier label ($13.00) on `B00MNV8E0C` → obs 18, later set `EXCLUDED` via `pnpm ops exclude 18` (actor `owner-cli`; raw row retained; analysis eligibleCount 0 / excluded 1) |
| Defect 2 (fixed)                          | Dedup A→B→A within 60 min dropped the return to A — fixed in `5859aae` (dedup only vs the latest row)                                                                                                         |
| Controlled DQ probe                       | ASIN `B0PTDQTEST` — 3 prices ~50000¢ ACCEPTED, one 500¢ QUARANTINED (`large_move_vs_recent_median`), excluded from history/analysis (`/home/ubuntu/dq-live-test.md`)                                          |
| Observations                              | 13 + live-test rows (statuses ACCEPTED 7, CORROBORATED 2, EXCLUDED 4+ as of 2026-09-16T22:59Z)                                                                                                                |
| Listings                                  | 11                                                                                                                                                                                                            |
| Retailers                                 | 2                                                                                                                                                                                                             |

## LIVE VALIDATION

| Check                                       | Result                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Public `/health`                            | 200                                                                                                                               |
| Public `/readiness`                         | 200 (`database=ok`, `migrations=ok`)                                                                                              |
| Internal auth deny/allow                    | 404 unauth/wrong; 200 with token                                                                                                  |
| HTTPS observation → Neon → history/analysis | Pass (probe then EXCLUDED)                                                                                                        |
| Rollup on Fly                               | Pass (scheduled machine, 8 listing-days recomputed)                                                                               |
| Archive on Fly volume                       | Pass (5 batches via `pricetruth_archive_jobs`)                                                                                    |
| Machine restart persistence                 | Pass (counts unchanged; volume intact)                                                                                            |
| Neon PITR restore                           | Pass (branch queried, matched live, deleted)                                                                                      |
| Anomaly quarantine end-to-end               | Pass (500¢ probe → QUARANTINED, excluded from analysis)                                                                           |
| Extension fixture suite vs live API         | Pass (sale/no-price/hidden-unit-only → nothing POSTed; API-unreachable → Retry; revisit → duplicate; change → new row)            |
| Amazon live PDP (hidden-price env)          | Pass — 4 real PDPs all hid the buy-box price here; extension correctly POSTed nothing                                             |
| Amazon live PDP (visible price)             | **UNTESTED** — needs an owner-side normal-priced PDP (this environment only found hidden-price pages)                             |
| Best Buy live PDP                           | **UNTESTED** — `ERR_HTTP2_PROTOCOL_ERROR` from this host on every attempt; not anti-bot, no transport. Owner manual test required |
| Rate-limit 429                              | **UNTESTED** — not safely testable via public endpoints                                                                           |
| Hidden-SnS fix live re-check                | Pass — `B00MNV8E0C` re-visit after 1.2.1: 0 POSTs, history empty                                                                  |

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

## NEXT TESTING STEPS (owner, in order)

1. **Amazon normal price** — install the unpacked zip, open any Amazon PDP showing a normal price → side panel shows the price; confirm via `pnpm ops recent --limit 5` (row with `extension:content-script`) or `pnpm ops listing amazon <ASIN>`.
2. **Amazon unit-price page** — a PDP with a "$X / count" unit line → verify the unit price is _not_ the observation (`ops listing` should show the pack price or nothing).
3. **Amazon List-price page** — a PDP with a struck-through list price → verify `referencePriceCents` is populated in the observation.
4. **3 Best Buy PDPs** — pick 3 products with visible prices → `pnpm ops listing bestbuy <SKU>` for each (SKU = digits in the URL).
5. Invite 5–10 beta testers after one successful real PDP round-trip.

## NEXT STEPS

1. Owner Chrome install + first real PDP observation (procedure above)
2. Wire GitHub canary/job secrets
3. Optional Best Buy API key (Fly secret → `pricetruth-bestbuy-refresh` activates)
4. R2 archive upgrade later (needs a valid Cloudflare token)
5. Set Fly + Neon spend limits / add card as needed
