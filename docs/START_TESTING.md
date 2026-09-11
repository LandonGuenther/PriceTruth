# Start testing (owner)

## What you need

| Item | Value |
|------|-------|
| API hostname | `https://pricetruth-api-staging.fly.dev` |
| Beta ZIP | `apps/extension/release/pricetruth-extension-0.1.0.zip` |
| Extension version | `0.1.0` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| ZIP SHA-256 | `44234ae83a301e7f28d34e521204a9656a8072769c577ee0107c2af9737a4cba` |

## Install (Chrome)

1. Unzip `pricetruth-extension-0.1.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (contains `manifest.json`).
5. Confirm the extension id is `hkpcfcjmogoaakoemandjkkdgnhpdejk`.
6. Open an Amazon or Best Buy product detail page (PDP).
7. Click the PriceTruth toolbar icon (solid blue square) to open the side panel.
8. Confirm the visible page price matches what PriceTruth shows.
9. Confirm an observation landed:

```bash
export PRICETRUTH_API_URL=https://pricetruth-api-staging.fly.dev
export INTERNAL_API_TOKEN=<from Fly secrets / password manager>
pnpm ops:status
# or:
pnpm ops remote
```

## Quick API checks

```bash
curl -sS https://pricetruth-api-staging.fly.dev/health
curl -sS https://pricetruth-api-staging.fly.dev/readiness
curl -sS -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  https://pricetruth-api-staging.fly.dev/internal/status
```

Expect health and readiness HTTP 200. Unauthenticated `/internal/status` must not succeed (404).

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Toolbar icon (blue square) click does nothing | Remove the old unpacked extension, load the new ZIP contents, click **Reload** on `chrome://extensions`, then pin PriceTruth and click the icon again |
| Side panel opens but is blank | Confirm `sidepanel.html` asset paths are relative (`./sidepanel.js`); rebuild if you still see `/sidepanel.js` |
| Side panel empty / network error | Rebuild with `VITE_API_BASE_URL=https://pricetruth-api-staging.fly.dev` |
| CORS / blocked fetch | Fly secret `ALLOWED_EXTENSION_IDS` must include `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| Readiness 503 | Neon connectivity or pending migrations |
| Internal status 404 | Missing/wrong `INTERNAL_API_TOKEN` |
| No observation on ambiguous/no price | Expected - extension must not POST |
| Fly app sleeping | Staging uses `auto_stop_machines=off` + min 1 machine |

## How do I know PriceTruth is down?

1. `curl https://pricetruth-api-staging.fly.dev/health` fails or non-200
2. `curl https://pricetruth-api-staging.fly.dev/readiness` non-200
3. GitHub Action `staging-canary` fails (once `STAGING_API_URL` is set)
4. `fly status -a pricetruth-api-staging` / `fly logs -a pricetruth-api-staging`
5. Neon dashboard shows project paused/errors
