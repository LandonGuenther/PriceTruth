# Staging deployment

Status: **LIVE** — https://pricetruth-api-staging.fly.dev (Fly `iad`, Neon `pricetruth-staging` Postgres 16.15)

See also: `docs/LIVE_BETA_REPORT.md`, `docs/START_TESTING.md`, `docs/COSTS.md`.

## Target shape

- Neon Postgres 16 (`pricetruth-staging`, us-east-1) - existing project; do not recreate.
- API on Fly.io from `apps/api/Dockerfile` via root `fly.toml`.
- App name: `pricetruth-api-staging` (or nearest available).
- Region: `iad` (near Neon us-east-1).
- Machine: `shared-cpu-1x` / 256 MB; `auto_stop_machines = "off"`; `min_machines_running = 1`.
- HTTPS via Fly proxy; internal port 3000; health check `GET /health`.
- `NODE_ENV=staging`, `HOST=0.0.0.0`, `LOG_LEVEL=info`, `TRUST_PROXY=true`.
- Secrets via Fly secret store: `DATABASE_URL`, `INTERNAL_API_TOKEN` (≥32 chars),
  `ALLOWED_EXTENSION_IDS` (pinned id `hkpcfcjmogoaakoemandjkkdgnhpdejk`),
  `BESTBUY_API_KEY` (optional), `ARCHIVE_BACKEND=local`, `ARCHIVE_LOCAL_DIR=/data/archive`.
- Archive: local on Fly volumes (see below — split across two volumes). R2 is a
  follow-up (previous Cloudflare token was invalid).
- Release command: `pnpm exec prisma migrate deploy` before traffic switch.

## Deploy steps

1. Ensure Fly auth: `FLY_API_TOKEN` in the agent/CI environment.
2. `fly apps create pricetruth-api-staging --org <org>` (once).
3. `fly secrets set DATABASE_URL=... INTERNAL_API_TOKEN=... ALLOWED_EXTENSION_IDS=hkpcfcjmogoaakoemandjkkdgnhpdejk ARCHIVE_BACKEND=local ARCHIVE_LOCAL_DIR=/data/archive`
4. `fly deploy --build-arg APP_VERSION=<git-sha>`
5. Confirm `GET https://pricetruth-api-staging.fly.dev/health` and `/readiness` → 200.
6. Smoke: synthetic observation POST, then `pnpm ops:status` with `PRICETRUTH_API_URL`.

`INTERNAL_API_TOKEN` was rotated 2026-09-18 and `DATABASE_URL` switched to the
Neon direct endpoint; unauth `/internal/status` → 404, authorized → 200.

## Scheduled jobs — Fly scheduled Machines (the real scheduler)

Jobs run as Fly scheduled Machines in the same app (256 MB,
`autostart=false`, metadata `fly_process_group=jobs`, `WORKDIR /app/apps/api`),
created/refreshed by `scripts/fly-schedule-jobs.sh` (runs at the end of
`deploy-staging.sh` so redeploys keep job images current):

| Machine                      | Fly schedule | Command                                                          |
| ---------------------------- | ------------ | ---------------------------------------------------------------- |
| `pricetruth-rollup`          | hourly       | `pnpm jobs rollup`                                               |
| `pricetruth-archive`         | daily        | `pnpm jobs archive` (volume `pricetruth_archive_jobs:/data`)     |
| `pricetruth-bestbuy-refresh` | daily        | `pnpm jobs bestbuy-refresh --min-age-hours 6 --max-listings 200` |

Fly "hourly/daily" schedules are relative to machine creation time
(~00:22Z/00:24Z UTC), not fixed wall-clock hours.

`pricetruth-bestbuy-refresh` printed `disabled (BESTBUY_API_KEY not set)` on its
first run — it activates once `BESTBUY_API_KEY` is set as a Fly secret.

**Archive volume split:** batches 1–4 (2026-09-11) live on the API machine's
volume `pricetruth_archive`; batches 5+ live on the job machine's volume
`pricetruth_archive_jobs`. Both are `local` backend — dedup reads only the
writer's volume, so the split is historical, not a correctness issue.

- `.github/workflows/staging-canary.yml` — health/readiness (+ optional internal
  status), dormant until GitHub secrets `STAGING_API_URL`,
  `STAGING_INTERNAL_API_TOKEN` are set (owner action).
- `.github/workflows/staging-jobs.yml` — `workflow_dispatch` manual fallback
  (no cron triggers); needs `FLY_API_TOKEN`, optional `FLY_APP_NAME`.

## CI hook

`.github/workflows/deploy-staging.yml` remains a `workflow_dispatch` scaffold for
image build notes; live deploys are done with `fly deploy` from this repo root.
