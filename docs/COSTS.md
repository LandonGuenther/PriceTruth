# Costs

Status: **DEPLOYED STAGING** — Fly app is live; amounts below are list-price estimates until the first invoice.

## Actual current footprint

| Item | State |
|------|-------|
| Fly app `pricetruth-api-staging` | Live in `iad`, 1× `shared-cpu-1x` 256 MB, always on |
| Fly volume `pricetruth_archive` | 1 GB attached at `/data` |
| Neon `neondb` (existing) | Live; used by staging API |
| Cloudflare R2 | Not configured |
| Dedicated IPv4 | Not allocated (shared IPv4 in use) |

## Estimated monthly baseline

| Item | Estimate | Notes |
|------|----------|-------|
| Fly `shared-cpu-1x` 256 MB always-on (`iad`) | ~$2.02 | Official Fly list price |
| Fly volume 1 GB | ~$0.15 | Local archive |
| Shared IPv4 + IPv6 | $0 | Dedicated IPv4 would add ~$2 if needed later |
| Neon existing project | often $0 on free/launch | Confirm in Neon console |
| GitHub Actions canary/jobs | pennies | Low-frequency crons |
| **Typical total** | **~$2–5 / month** | Hard guardrail: do not exceed ~$25 without owner approval |

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
