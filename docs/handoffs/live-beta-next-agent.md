# Live-beta handoff (next agent)

Status when written: **blocked only on secret injection into a fresh agent VM**.

This agent (`PriceTruth staging deployment`) started **before** secrets were added.
Cursor injects Cloud Agent secrets **only at agent start**, so this VM will never see them.
Owner completed the secrets UI; Best Buy / Internal tokens are intentionally optional.

## What the next agent must do

1. Confirm env has `FLY_API_TOKEN` and `DATABASE_URL` (do not print values).
2. Generate `INTERNAL_API_TOKEN` with `openssl rand -hex 32` if unset.
3. Leave `BESTBUY_API_KEY` unset → Best Buy official refresh stays NOT CONFIGURED.
4. Run from repo root on branch `cursor/live-beta-bringup`:

```bash
./scripts/deploy-staging.sh
```

5. Then continue remaining phases from the original bring-up brief:
   - public `/health` + `/readiness`
   - internal auth checks
   - controlled observation write → Neon → history/analysis
   - extension build/package with real HTTPS API (no localhost)
   - browser E2E + polite live retailer checks
   - jobs/canary/rollup/archive
   - restart persistence test
   - finalize `docs/LIVE_BETA_REPORT.md` with real values
   - push + update PR #11

## Already done on `cursor/live-beta-bringup`

- Branched from `origin/devin/live-beta-bringup` (not from main)
- Local baseline green: 373 tests + lint/typecheck/build
- `fly.toml` (iad, shared-cpu-1x, no auto-stop, archive volume)
- Dockerfile volume entrypoint
- `.github/workflows/staging-jobs.yml`
- `scripts/deploy-staging.sh`
- Operator docs: LIVE_BETA_REPORT, START_TESTING, BETA_TESTER_GUIDE, DATA_COLLECTION_START, COSTS

## Credential policy

| Secret | Required | Notes |
|--------|----------|-------|
| `FLY_API_TOKEN` | yes | Personal Fly account OK |
| `DATABASE_URL` | yes | Existing Neon `pricetruth-staging` |
| `NEON_API_KEY` | no | Optional metadata/PITR checks |
| `BESTBUY_API_KEY` | no | Solo/pre-company: skip |
| `INTERNAL_API_TOKEN` | no | Generate at deploy; store in Fly only |

## PR

https://github.com/landonguenther/pricetruth/pull/11
