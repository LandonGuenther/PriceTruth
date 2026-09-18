# Start testing (owner)

## What you need

| Item              | Value                                                              |
| ----------------- | ------------------------------------------------------------------ |
| API hostname      | `https://pricetruth-api-staging.fly.dev`                           |
| Beta ZIP          | `apps/extension/release/pricetruth-extension-0.1.0.zip`            |
| Extension version | `0.1.0`                                                            |
| Extension ID      | `hkpcfcjmogoaakoemandjkkdgnhpdejk`                                 |
| ZIP SHA-256       | `030eb7d5a52cc136be5aec5e4708d62424691257b6ecaf0834cbd8cb6967cca0` |

## Install (Chrome)

1. Unzip `pricetruth-extension-0.1.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (contains `manifest.json`).
5. Confirm the extension id is `hkpcfcjmogoaakoemandjkkdgnhpdejk`.
6. Open an Amazon or Best Buy product detail page (PDP).
7. Open the PriceTruth side panel.
8. Confirm the visible page price matches what PriceTruth shows.
9. Confirm an observation landed:

```bash
PRICETRUTH_API_URL=https://pricetruth-api-staging.fly.dev \
  INTERNAL_API_TOKEN=<token> pnpm ops:status
# or: pnpm ops remote
```

The token is the Devin secret `PRICETRUTH_STAGING_INTERNAL_API_TOKEN` /
the Fly secret `INTERNAL_API_TOKEN` (rotated 2026-09-18). Never commit it —
it lives only in Fly secrets / password manager / Devin secrets.

Other read-only checks: `pnpm ops recent --limit 10`, `pnpm ops jobs`,
`pnpm ops listing <retailer> <externalId>` (local DB only — these need
`DATABASE_URL`; for the live DB use `pnpm ops:status`).

## Quick API checks

```bash
curl -sS https://pricetruth-api-staging.fly.dev/health
curl -sS https://pricetruth-api-staging.fly.dev/readiness
curl -sS -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  https://pricetruth-api-staging.fly.dev/internal/status
```

Expect health and readiness HTTP 200. Unauthenticated `/internal/status` must not succeed (404).

## Troubleshooting

| Symptom                              | Check                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| Side panel empty / network error     | Rebuild with `VITE_API_BASE_URL=https://pricetruth-api-staging.fly.dev`            |
| CORS / blocked fetch                 | Fly secret `ALLOWED_EXTENSION_IDS` must include `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Readiness 503                        | Neon connectivity or pending migrations                                            |
| Internal status 404                  | Missing/wrong `INTERNAL_API_TOKEN`                                                 |
| No observation on ambiguous/no price | Expected - extension must not POST                                                 |
| Fly app sleeping                     | Staging uses `auto_stop_machines=off` + min 1 machine                              |

## How do I know PriceTruth is down?

1. `curl https://pricetruth-api-staging.fly.dev/health` fails or non-200
2. `curl https://pricetruth-api-staging.fly.dev/readiness` non-200
3. GitHub Action `staging-canary` fails (once `STAGING_API_URL` is set)
4. `fly status -a pricetruth-api-staging` / `fly logs -a pricetruth-api-staging`
5. Neon dashboard shows project paused/errors
