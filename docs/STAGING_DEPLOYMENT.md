# Staging deployment

Status: IN PROGRESS (Fly.io target; blocked on `FLY_API_TOKEN` + `DATABASE_URL` in the Cursor agent)

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
- Archive: local on a 1 GB Fly volume (`pricetruth_archive` → `/data`). R2 is a
  follow-up (previous Cloudflare token was invalid).
- Release command: `pnpm exec prisma migrate deploy` before traffic switch.

## Deploy steps

1. Ensure Fly auth: `FLY_API_TOKEN` in the agent/CI environment.
2. `fly apps create pricetruth-api-staging --org <org>` (once).
3. `fly secrets set DATABASE_URL=... INTERNAL_API_TOKEN=... ALLOWED_EXTENSION_IDS=hkpcfcjmogoaakoemandjkkdgnhpdejk ARCHIVE_BACKEND=local ARCHIVE_LOCAL_DIR=/data/archive`
4. `fly deploy --build-arg APP_VERSION=<git-sha>`
5. Confirm `GET https://pricetruth-api-staging.fly.dev/health` and `/readiness` → 200.
6. Smoke: synthetic observation POST, then `pnpm ops:status` with `PRICETRUTH_API_URL`.

## Scheduled jobs

- `.github/workflows/staging-canary.yml` - health/readiness (+ optional internal status).
  Needs GitHub secrets: `STAGING_API_URL`, `STAGING_INTERNAL_API_TOKEN`.
- `.github/workflows/staging-jobs.yml` - rollup / archive / bestbuy-refresh via
  `fly ssh console`. Needs GitHub secrets: `FLY_API_TOKEN`, optional `FLY_APP_NAME`.

## CI hook

`.github/workflows/deploy-staging.yml` remains a `workflow_dispatch` scaffold for
image build notes; live deploys are done with `fly deploy` from this repo root.
