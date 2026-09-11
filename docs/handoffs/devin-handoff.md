# Devin → Cursor handoff: production-backend sprint

## BASE MAIN SHA

`5e9dd67` (origin/main at branch point, includes PRs #5–#7).

## DEVIN BRANCH SHA (TBD)

Branch: `devin/production-backend-beta`. Head: TBD.

## Baseline (M0)

Fresh checkout of `origin/main` @ `5e9dd67`, `pnpm install`, Postgres 16 via `docker compose up -d db`, `prisma migrate deploy` → 7 migrations, none pending.

| Check               | Result                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm lint`         | pass                                                                                           |
| `pnpm format:check` | pass                                                                                           |
| `pnpm typecheck`    | pass                                                                                           |
| `pnpm build`        | pass                                                                                           |
| `pnpm test`         | 270 tests pass — shared 17, catalog 16, scoring 39, retailer-adapters 92, extension 24, api 82 |

## API contract changes

- Every response carries headers `x-pricetruth-api-version: 1`,
  `x-pricetruth-observation-schema-version: 1`, and `x-request-id` (honours a
  valid inbound `^[A-Za-z0-9._-]{1,128}$`, else UUID).
- Success bodies gain `apiVersion: 1` (POST /v1/observations, analysis,
  history, /health, /readiness).
- New `GET /readiness` (200 ready / 503 not_ready with per-check status).
- `/health` no longer fails on db errors; adds `apiVersion`, `uptimeSeconds`,
  `version` (APP_VERSION env or "dev").
- Rate limits are per endpoint class (defaults: ingest 60/min, read 240/min,
  health 600/min per IP); 429 body `{error:"rate_limited", message,
retryAfterSeconds}`.
- CORS: `chrome-extension://` origins restricted to `ALLOWED_EXTENSION_IDS`
  when set; no-Origin and `CORS_ORIGINS` unchanged.
- Policy doc: docs/API_COMPATIBILITY.md.

## shared type changes

None — new fields are typed API-side (intersection types).

## new env vars

`NODE_ENV`, `HOST` (now env-aware default), `LOG_LEVEL`, `TRUST_PROXY`,
`ALLOWED_EXTENSION_IDS`, `RATE_LIMIT_INGEST_PER_MINUTE`,
`RATE_LIMIT_READ_PER_MINUTE`, `RATE_LIMIT_HEALTH_PER_MINUTE`,
`REQUEST_TIMEOUT_MS`, `BODY_LIMIT_BYTES`, `INTERNAL_API_TOKEN`,
`ARCHIVE_BACKEND`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_REQUEST_TIMEOUT_MS`,
`APP_VERSION`. All documented in `.env.example`.

## new API fields

`apiVersion` (success bodies); `/health`: `uptimeSeconds`, `version`;
`/readiness`: `status`, `checks.{database,migrations}`.

## deprecated fields

None removed. Deprecation policy defined in docs/API_COMPATIBILITY.md
(`Deprecation` header ≥2 minor releases / 90 days before removal, never in v1).

## staging/production API expectations

- `NODE_ENV=staging|production` → `HOST` defaults `0.0.0.0`.
- `NODE_ENV=production` fails fast if `DATABASE_URL` points at localhost.
- `ALLOWED_EXTENSION_IDS` unset warns in staging/production (any extension id
  allowed); set it to the pinned extension id.
- `INTERNAL_API_TOKEN` ≥32 chars when set.
- `TRUST_PROXY` must reflect the real proxy topology or rate limiting keys on
  the proxy IP.

## extension integration actions

- Read `x-pricetruth-api-version` / `x-request-id` response headers; send a
  stable `x-pricetruth-client-version` (already done).
- Pin the extension `key` in the manifest so its id is stable for
  `ALLOWED_EXTENSION_IDS`.
- Handle 429 using `retryAfterSeconds`.
- `VITE_API_BASE_URL` must be `https://api-staging.<domain>` /
  `https://api.<domain>` at build time; recommend failing the build when unset
  in production mode.
- Optional: send `x-request-id` for correlating client/server logs.

## M2 additions

- Archive backend selectable via `ARCHIVE_BACKEND` (`local`|`s3`);
  `S3CompatibleArchive` with `IfNoneMatch` + sha256 integrity (R2/S3/MinIO).
- `jobs archive` gains `--dry-run`; `jobs rollup`/`jobs archive` run under a
  `JobCheckpoint` lease + `JobRun` ledger (migration `job_leases_and_runs`,
  additive: `lockedBy`/`lockedUntil` + new `JobRun`/`JobRunStatus`).
- Exporter hardening: object-present/no-ledger replays compare sha256
  (equal → backfill ledger; different → `ArchiveIntegrityError`).

## compatibility risks

- 429 response shape changed from Fastify default to
  `{error:"rate_limited", message, retryAfterSeconds}`.
- Rate limits dropped from 120/min global to per-class (read endpoints got more
  headroom, ingest tightened to 60/min).

## commands after rebase

```sh
git fetch && git rebase origin/main && pnpm install && pnpm -r build && pnpm lint && pnpm typecheck && pnpm test
```
