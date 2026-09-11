# Browser Extension (MV3)

`apps/extension` — Chrome MV3 side-panel extension. A content script extracts a
`RetailerObservation` on supported product pages (Amazon, Best Buy); a service
worker posts it to the API, then pulls analysis + history into per-tab state
(`chrome.storage.session`); the side panel renders it.

## Dev loop

```sh
pnpm --filter @pricetruth/extension build   # → apps/extension/dist
# chrome://extensions → Developer mode → Load unpacked → select apps/extension/dist
```

Rebuild after changes and hit the extension's "reload" icon. Content-script
changes also need a page reload.

## Environment

`VITE_API_BASE_URL` (build-time) sets the API origin — it becomes the only
`host_permission`. Default `http://127.0.0.1:3000` (see `.env.example`).
Production builds must set it to the deployed API origin.

## Permissions rationale

| Permission / capability            | Why                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel`                        | Show the analysis panel when the toolbar action is clicked.                                                                 |
| `storage`                          | `chrome.storage.session` holds per-tab `TabState` — in-memory only, cleared with the session; nothing is persisted to disk. |
| `host_permissions: <API origin>/*` | The service worker calls the PriceTruth API.                                                                                |
| `content_scripts.matches`          | Read-only DOM extraction on Amazon/Best Buy product pages.                                                                  |

Deliberately absent: `tabs` (the panel only needs `tab.id`, which
`chrome.tabs.query` exposes without it; it never reads `tab.url`), `history`,
`<all_urls>`, `cookies`, `webRequest`, `scripting`.

## Privacy / telemetry statement

The extension sends only `RetailerObservation` fields (retailer, external id,
url, title, brand/model, prices, currency, availability, variant, source,
observedAt) plus the `x-pricetruth-client-version` header to the API. It never
reads cookies or form fields, never writes to the DOM, and collects no browsing
history or page content beyond product metadata and prices. The user-agent
string is hashed (sha256) server-side and never stored raw.

## Packaging

```sh
pnpm --filter @pricetruth/extension build
pnpm --filter @pricetruth/extension package   # → release/pricetruth-extension-<version>.zip
```

`release/` is gitignored.
