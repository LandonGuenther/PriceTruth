# Costs

Status: **DEPLOYED STAGING** — Fly app is live; amounts below are list-price estimates until the first invoice.

## Actual current footprint

| Item                             | State                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fly app `pricetruth-api-staging` | Live in `iad`, 1× `shared-cpu-1x` 256 MB, always on                                                                                                        |
| Fly job machines ×3              | `pricetruth-rollup` hourly, `pricetruth-archive` daily, `pricetruth-bestbuy-refresh` daily — stopped between runs; cost ≈ rootfs only + seconds of compute |
| Fly volumes ×2 1 GB              | `pricetruth_archive` (API machine) + `pricetruth_archive_jobs` (archive job)                                                                               |
| Neon `neondb` (existing)         | Live; used by staging API                                                                                                                                  |
| Cloudflare R2                    | Not configured                                                                                                                                             |
| Dedicated IPv4                   | Not allocated (shared IPv4 in use)                                                                                                                         |

## Estimated monthly baseline

| Item                                         | Estimate            | Notes                                                     |
| -------------------------------------------- | ------------------- | --------------------------------------------------------- |
| Fly `shared-cpu-1x` 256 MB always-on (`iad`) | ~$2.02              | Official Fly list price                                   |
| Fly volumes 2 × 1 GB                         | ~$0.30              | `pricetruth_archive` + `pricetruth_archive_jobs`          |
| Fly job machines ×3 stopped                  | ~$0                 | Stopped machines cost rootfs storage only                 |
| Shared IPv4 + IPv6                           | $0                  | Dedicated IPv4 would add ~$2 if needed later              |
| Neon existing project (free)                 | $0                  | Free plan; PITR window 6 h                                |
| GitHub Actions canary                        | pennies             | Dormant until secrets set                                 |
| **Typical total**                            | **~$2.5–3 / month** | Hard guardrail: do not exceed ~$25 without owner approval |

## Projections (not current usage)

At ~~1k extension users: same footprint (~~$3/mo); Neon free tier is the first
thing to outgrow. At ~10k: likely $10–20/mo (larger machine, Neon paid tier,
possibly R2 archive). Projections, not commitments.

## Future estimates (not enabled)

| Item                  | Estimate                         |
| --------------------- | -------------------------------- |
| Cloudflare R2 archive | low dollars + request fees       |
| Larger Fly machine    | only if CPU/RAM pressure appears |
| Extra Fly regions     | not needed for beta              |

## Cost controls in config

- Single small Machine in `iad`
- No Redis / Kafka / ClickHouse
- No auto-scale beyond 1 Machine for beta
- Archive on small local volume until R2 is ready
