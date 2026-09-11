# Live-beta handoff (next agent)

Status when written: **Neon LIVE / Fly BLOCKED on billing**.

Agent: PriceTruth staging deployment on branch `cursor/live-beta-bringup`
PR: https://github.com/LandonGuenther/PriceTruth/pull/11

## What works now

- Branch `cursor/live-beta-bringup` includes Devin bring-up + Cursor Fly/docs/scripts
- Local gates green (373 tests)
- Neon `neondb` on host `ep-sparkling-paper-aukmmxhh-pooler.c-10.us-east-1.aws.neon.tech`:
  - Postgres 16.15, TLS, 8 migrations applied
  - Local API against Neon: health/readiness/internal auth OK
  - Controlled probe observation written then EXCLUDED
  - Rollup + archive jobs succeeded against Neon
- `flyctl` authenticated; personal org (`landonguenther00@gmail.com`) visible
- **`fly apps create pricetruth-api-staging` fails** until billing is added:
  https://fly.io/dashboard/personal/billing

## Immediately after Fly billing is active

```bash
# Secrets must be in env (prefer Cursor secure secrets — do not paste into chat)
# Required: FLY_API_TOKEN, DATABASE_URL
# Optional: INTERNAL_API_TOKEN (else generated), BESTBUY_API_KEY
./scripts/deploy-staging.sh
```

Then continue: public HTTPS checks, extension build with real URL, E2E, canary secrets, finalize `docs/LIVE_BETA_REPORT.md`, push, update PR #11.

## Security

Credentials were pasted into chat once. Owner should **rotate Fly token + Neon password** after staging is up. Never commit secrets.
