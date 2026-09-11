# Staging deployment

Status: PLANNED (workflow scaffold exists; no staging host provisioned yet)

## Target shape

- Postgres 16 (managed or container) with its own volume.
- API from `apps/api/Dockerfile` (`pricetruth-api:<sha>`), port 3000 behind a
  TLS-terminating proxy; `TRUST_PROXY` set to match the proxy hop count.
- `NODE_ENV=staging`, `HOST=0.0.0.0`, `LOG_LEVEL=info`.
- Secrets via the platform's secret store: `DATABASE_URL`,
  `INTERNAL_API_TOKEN` (≥32 chars), `BESTBUY_API_KEY` (optional),
  `ALLOWED_EXTENSION_IDS` (pinned extension id), `CORS_ORIGINS` if needed.
- Archive to object storage: `ARCHIVE_BACKEND=s3` + `S3_*` vars.

## Deploy steps

1. `docker build -f apps/api/Dockerfile --build-arg APP_VERSION=<sha> -t pricetruth-api:<sha> .`
2. Push to the registry; on the host run migrations first:
   `docker run --rm -e DATABASE_URL=... pricetruth-api:<sha> pnpm exec prisma migrate deploy`
3. Start the container; confirm `GET /readiness` → 200 (`migrations: ok`).
4. Smoke: `POST /v1/observations` with a synthetic observation, then
   `GET /internal/status` with the ops token.

## CI hook

`.github/workflows/deploy-staging.yml` is a `workflow_dispatch` scaffold —
it builds the image and prints the runbook; the actual registry-push/host steps
are filled in once the staging host exists.
