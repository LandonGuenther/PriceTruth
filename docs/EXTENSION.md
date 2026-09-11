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

## Per-tab state & navigation

`TabState` lives in `chrome.storage.session` under `tab:<tabId>` (in-memory
only). `tabs.onRemoved` clears it. On `tabs.onUpdated` with `status:"loading"`,
the service worker waits ~1.5s and pings the tab (`pt/ping` → `pt/pong`). No
answer means the tab left a supported host or is still loading → state resets
to `idle`. If the content script is alive, state is left alone (a supported
product page repopulates it via the observer); this also means Amazon's ghost
`loading` events after page load cannot wipe a ready panel. A state of
`loading` (ingest in flight) is never reset by the ping check.

We deliberately do not use the `tabs` permission — it would expose the URLs of
all tabs and shows users a "read your browsing history" warning. Without it,
`changeInfo.url` is never delivered, hence the ping design. The ping is also
why navigating from a product page to a supported host's non-product page (e.g.
the Amazon home page) reports `not_product_page` — the content script stays
injected and tells the panel directly.

## Environment

`VITE_API_BASE_URL` (build-time) sets the API origin — it becomes the only
`host_permission`. Default `http://127.0.0.1:3000` (see `.env.example`).
Production builds must set it to the deployed API origin.

## Supported product pages

- **Amazon**: `/dp/<ASIN>`, `/gp/product/<ASIN>`, `/gp/aw/d/<ASIN>` (see the
  adapter for the full pattern list).
- **Best Buy**: legacy `/site/<slug>/<sku>.p` / `?skuId=` URLs **and** the new
  `/product/<slug>/<code>` format. On `/product/` pages the URL carries no SKU,
  so identity comes from the page (JSON-LD `sku`, then the "SKU: …" label); the
  page SKU always wins over any URL-derived value.

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

## Manual real-page testing

Method used to verify the extension end-to-end against live pages:

1. Start the API and DB (`pnpm --filter @pricetruth/api start`, `docker compose up -d db`).
2. Load `apps/extension/dist` unpacked and open the side panel.
3. Visit supported product pages one at a time (~8s apart — be polite).
4. For each page, check that a `PriceObservation` row appeared
   (`select o."priceCents", o."referencePriceCents" from "PriceObservation" o
join "Listing" l on l.id = o."listingId" where l."externalId" = '<id>'
order by o."observedAt" desc limit 1;`) and that
   `GET /v1/listings/<retailer>/<id>/analysis` returns 200. With only a handful
   of observations, expect `confidence: "INSUFFICIENT"` and null scores — that
   is correct.

Known Amazon behaviors seen live (all expected, not bugs):

- Some product pages render no price at all — "add to cart to see price" or
  "See All Buying Options" walls, or thin renders. The adapter reports
  `no_price`/`not_product_page`, nothing is recorded.
- Sustained browsing triggers Amazon `503 Service Unavailable` pages; no
  observation is written for those. Waiting ~30s and continuing is enough;
  never try to bypass.
- `/dp/`, `/gp/product/` and `/gp/aw/d/` forms all ingest identically; revisits
  within the dedup window are accepted as duplicates.

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
