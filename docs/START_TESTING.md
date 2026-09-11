# Start testing (owner)

## What you need

| Item | Value |
|------|-------|
| API hostname | `https://pricetruth-api-staging.fly.dev` |
| Beta ZIP | `apps/extension/release/pricetruth-extension-0.1.2.zip` |
| Extension version | `0.1.2` |
| Extension ID | `hkpcfcjmogoaakoemandjkkdgnhpdejk` |
| ZIP SHA-256 | `ca57839773346e69d5ee684617d7ccf0f08b10d5be511aad094cd9d7cdb86c25` |

## Install (Chrome / Opera / Edge)

1. Unzip `pricetruth-extension-0.1.2.zip`.
2. Open the extensions page (`chrome://extensions`, `opera://extensions`, or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (contains `manifest.json`).
5. Confirm the extension id is `hkpcfcjmogoaakoemandjkkdgnhpdejk` and version is **0.1.2**.
6. Open an Amazon or Best Buy product detail page (PDP).
7. Click the PriceTruth toolbar icon (solid blue square).
   - Chrome / Edge: side panel opens on the right.
   - Opera: PriceTruth UI opens in the toolbar popup (Opera has no Chrome side panel API).
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
| Toolbar icon (blue square) click does nothing | You must be on **version 0.1.2**. Remove every PriceTruth entry, load the new unzipped folder, confirm version **0.1.2**, pin the icon, open an Amazon/Best Buy PDP, then click |
| Opera: side panel error / no Chrome side panel | Expected on Opera: 0.1.2 opens the PriceTruth UI in the toolbar popup instead (Opera lacks Chrome's side panel API) |
| Side panel opens but is blank | Confirm `sidepanel.html` asset paths are relative (`./sidepanel.js`); rebuild if you still see `/sidepanel.js` |
| Click works only as a brief flash (Chrome/Edge) | Expected: popup closes immediately after opening the side panel on the right |
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
