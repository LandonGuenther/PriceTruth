# Live-beta handoff (next agent)

Status when written: **API LIVE on Fly + Neon**. Extension beta ZIP ready.

Branch: `cursor/live-beta-bringup`
PR: https://github.com/LandonGuenther/PriceTruth/pull/11
Public API: https://pricetruth-api-staging.fly.dev

## Verified live

- Fly app `pricetruth-api-staging` in `iad` (shared-cpu-1x / 256MB, auto-stop off)
- Neon `neondb` on `ep-sparkling-paper-aukmmxhh-pooler.c-10.us-east-1.aws.neon.tech` (Postgres 16.15, 8 migrations)
- Public `/health` + `/readiness` 200
- Internal auth deny/allow
- HTTPS observation write → Neon → history/analysis
- Rollup + archive jobs on Fly
- Machine restart persistence (Neon + `/data` archive volume)
- Extension package `pricetruth-extension-0.1.0.zip` with staging HTTPS URL (no localhost)
  - SHA-256 `030eb7d5a52cc136be5aec5e4708d62424691257b6ecaf0834cbd8cb6967cca0`

## Remaining owner actions

1. Rotate Fly token + Neon password (were pasted into chat).
2. GitHub secrets: `STAGING_API_URL`, `STAGING_INTERNAL_API_TOKEN`, `FLY_API_TOKEN`.
3. Load beta ZIP in Chrome; capture first real Amazon/Best Buy PDP observation.
4. Optional: `BESTBUY_API_KEY`.

## Do not

- Recreate Neon project
- Paste secrets into chat/PR/docs
- Merge until owner confirms a real PDP observation if that is the merge gate
