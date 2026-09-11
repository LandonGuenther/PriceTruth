# Start testing (owner)

Status: **WAITING ON STAGING URL** - fill in the TBD fields after deploy completes.

## What you need

| Item | Value |
|------|-------|
| API hostname | TBD (`https://pricetruth-api-staging.fly.dev` intended) |
| Beta ZIP | TBD (`apps/extension/release/pricetruth-extension-0.1.0.zip`) |
| Extension version | `0.1.0` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |

## Install (Chrome)

1. Unzip the beta package if you received a zip (or use the unpacked `dist/` from the packaged build).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extension folder (the one that contains `manifest.json`).
5. Confirm the extension id is `hkpcfcjmogoaakoemandjkkdgnhpdejk` (pinned via manifest `key`).
6. Open an Amazon or Best Buy product detail page (PDP).
7. Open the PriceTruth side panel from the extensions toolbar.
8. Confirm the visible page price matches what PriceTruth shows.
9. Confirm an observation landed using ops tooling:

```bash
export PRICETRUTH_API_URL=https://<STAGING_HOST>
export INTERNAL_API_TOKEN=<from Fly secrets / password manager>
pnpm ops:status
# or:
pnpm ops remote
```

## Quick API checks

```bash
curl -sS "$PRICETRUTH_API_URL/health"
curl -sS "$PRICETRUTH_API_URL/readiness"
curl -sS -H "Authorization: Bearer $INTERNAL_API_TOKEN" "$PRICETRUTH_API_URL/internal/status"
```

Expect health and readiness HTTP 200. Unauthenticated `/internal/status` must not succeed.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Side panel empty / network error | Extension built with wrong `VITE_API_BASE_URL`; rebuild against HTTPS staging |
| CORS / blocked fetch | `ALLOWED_EXTENSION_IDS` on Fly must include `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Readiness 503 | Neon connectivity or pending migrations |
| Internal status 404 | Missing/wrong `INTERNAL_API_TOKEN` (routes intentionally hide as 404) |
| No observation on ambiguous/no price | Expected - extension must not POST |
| Fly app sleeping | Staging is configured with auto-stop off + min 1 machine |

## How do I know PriceTruth is down?

1. `curl https://<host>/health` fails or non-200
2. `curl https://<host>/readiness` non-200
3. GitHub Action `staging-canary` fails (once `STAGING_API_URL` is set)
4. `fly status -a pricetruth-api-staging` / `fly logs -a pricetruth-api-staging`
5. Neon dashboard shows project paused/errors
