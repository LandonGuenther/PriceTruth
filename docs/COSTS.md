# Costs

Status: **PLANNED / ESTIMATED** until Fly and Neon bills are observed after deploy.

## Actual current cost

| Item | Actual |
|------|--------|
| Fly.io staging app | $0 (not deployed yet in this session) |
| Neon `pricetruth-staging` | Existing project; exact invoice not read without Neon access |
| Cloudflare R2 | Not configured |
| Archive volume | Not provisioned yet |

## Planned beta monthly baseline

| Item | Estimate | Notes |
|------|----------|-------|
| Fly `shared-cpu-1x` 256 MB × 1 always-on | ~$2–5 | `auto_stop` off for reliable extension calls |
| Fly volume 1 GB | ~$0.15 | Local archive backend |
| Neon staging (existing) | often $0–few dollars on free/launch tiers | Confirm in Neon console |
| GitHub Actions canary/jobs | pennies | Low-frequency crons |
| **Total beta baseline** | **~$3–10 / month typical** | Hard guardrail: do not exceed ~$25 without owner approval |

## Future estimates (not enabled)

| Item | Estimate |
|------|----------|
| Cloudflare R2 archive | low dollars + request fees |
| Larger Fly machine | only if CPU/RAM pressure appears |
| Extra Fly regions | not needed for beta |

## Cost controls in config

- Single small Machine in `iad`
- No Redis / Kafka / ClickHouse
- No auto-scale beyond 1 Machine for beta
- Archive on small local volume until R2 is ready
