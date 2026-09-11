# Live-beta handoff

Current agent: https://cursor.com/agents/bc-280b9d39-9530-4944-b615-682149ad7fe2
Branch: `cursor/live-beta-bringup`
PR: https://github.com/LandonGuenther/PriceTruth/pull/11

## Blocker

`FLY_API_TOKEN` and staging `DATABASE_URL` (Neon) are **not** present in this Cloud Agent VM.
Secrets were requested via Cursor's secure `add_secrets` flow. They inject at agent start;
if the UI completes mid-run, confirm they appear in the env (names only) or start a fresh
agent on this branch with the same environment.

Do **not** ask the owner to paste tokens into chat.

## Credential policy

| Secret | Required | Notes |
|--------|----------|-------|
| `FLY_API_TOKEN` | yes | Personal Fly account OK |
| `DATABASE_URL` | yes | Existing Neon `pricetruth-staging` |
| `NEON_API_KEY` | no | Optional metadata/PITR checks |
| `BESTBUY_API_KEY` | no | Official refresh stays NOT CONFIGURED |
| `INTERNAL_API_TOKEN` | no | Generate at deploy; store in Fly only |

## Already done

- Branched from `origin/devin/live-beta-bringup` (not from main)
- Devin: Best Buy refresh job, ops CLI, staging canary, docs, tests
- Cursor: `fly.toml`, volume entrypoint, `staging-jobs.yml`, `scripts/deploy-staging.sh`, operator docs
- Baseline re-verified this session: lint, typecheck, **373 tests**, build
- Fixed `migration.test.ts` so missing `DATABASE_URL` skips cleanly
- `flyctl` installed; deploy script ready: `./scripts/deploy-staging.sh`

## Next steps once secrets are present

1. Confirm `FLY_API_TOKEN` and `DATABASE_URL` are set (do not print values).
2. Generate `INTERNAL_API_TOKEN` with `openssl rand -hex 32` if unset.
3. Leave `BESTBUY_API_KEY` unset unless provided.
4. From repo root on `cursor/live-beta-bringup`:

```bash
./scripts/deploy-staging.sh
```

5. Continue remaining bring-up phases:
   - public `/health` + `/readiness`
   - internal auth checks
   - controlled observation write → Neon → history/analysis
   - extension build/package with real HTTPS API (no localhost)
   - browser E2E + polite live retailer checks
   - jobs/canary/rollup/archive
   - restart persistence test
   - finalize `docs/LIVE_BETA_REPORT.md` with real values
   - push + update PR #11
