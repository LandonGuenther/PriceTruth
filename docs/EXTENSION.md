# Browser Extension (MV3)

`apps/extension` is the Chrome MV3 side-panel extension for PriceTruth. A content
script extracts a `RetailerObservation` on supported product pages (Amazon, Best
Buy). A service worker posts it to the API, then pulls analysis and history into
per-tab state (`chrome.storage.session`). The side panel renders that state.

Related docs:

- [EXTENSION_ARCHITECTURE.md](./EXTENSION_ARCHITECTURE.md) - messaging, storage, adapters
- [EXTENSION_QA.md](./EXTENSION_QA.md) - automated and manual QA
- [EXTENSION_PERFORMANCE.md](./EXTENSION_PERFORMANCE.md) - bundle sizes and timers
- [EXTENSION_OVERNIGHT_REPORT.md](./EXTENSION_OVERNIGHT_REPORT.md) - sprint status
- [EXTENSION_REAL_WORLD_TEST_MATRIX.md](./EXTENSION_REAL_WORLD_TEST_MATRIX.md) - daytime matrix

## Architecture (brief)

```
content script (observer + @pricetruth/retailer-adapters)
  → chrome.runtime messages (pt/observation | pt/extraction-failed)
service worker (handler + ApiClient)
  → POST /v1/observations, GET analysis + history
  → chrome.storage.session[tab:<tabId>]
side panel (useTabState → Panel)
```

Retailer DOM logic lives in `@pricetruth/retailer-adapters`. The extension never
writes to page DOM and never reads cookies or form fields.

## Dev loop and load unpacked

```sh
pnpm --filter @pricetruth/extension build   # → apps/extension/dist
```

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `apps/extension/dist`
4. Click the PriceTruth toolbar action to open the side panel

Rebuild after changes and hit the extension's reload icon. Content-script
changes also need a page reload.

## Environment

`VITE_API_BASE_URL` (build-time) sets the API origin. It becomes the only
`host_permission`. Default `http://127.0.0.1:3000` (see `.env.example`).
Production builds must set it to the deployed API origin.

## Supported product pages

- **Amazon**: `/dp/<ASIN>`, `/gp/product/<ASIN>`, `/gp/aw/d/<ASIN>` (see the
  adapter for the full pattern list). Also matches `smile.amazon.com`.
- **Best Buy**: legacy `/site/<slug>/<sku>.p` / `?skuId=` URLs and the
  `/product/<slug>/<code>` format (optionally followed by `/sku/<id>` or other
  sub-paths like `/reviews`). The page SKU always wins over any URL-derived
  value. Cross-sell, carousel, and sponsored price blocks are ignored when
  resolving the product's own price.

## TabState machine

Formal statuses in `apps/extension/src/messages.ts`:

| Status        | Meaning                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `idle`        | No supported product context for this tab (or left a supported host).                                                  |
| `unsupported` | On a supported host, but not a usable product extract (`not_product_page`, `no_price`, `no_identifier`, `invalid`, …). |
| `ambiguous`   | Product found, but price confidence is `AMBIGUOUS` / reason `ambiguous_price`. Nothing is ingested.                    |
| `loading`     | Ingest in flight. `phase`: `submitting` then `analyzing`. Carries `generation`.                                        |
| `ready`       | Analysis + history loaded. May still be `confidence.level === "INSUFFICIENT"`.                                         |
| `error`       | API/network/timeout/unknown failure. `kind` classifies the error; Retry re-runs the last observation.                  |

Identity changes must move through `loading` (or `unsupported` / `ambiguous`) and
must not leave a previous product's `ready` analysis on screen.

### Generation tokens

The service worker keeps a per-tab monotonic generation counter. Every new
observation ingest or retry bumps it. When analysis returns, the handler ignores
the result if the tab's current generation no longer matches. Leaving a
supported host also bumps generation so a late response cannot resurrect idle
tabs.

### Navigation without `tabs` permission

We deliberately do not use the `tabs` permission (that warning reads as "read
your browsing history"). Without it, `changeInfo.url` is never delivered. On
`tabs.onUpdated` with `status: "loading"`, the service worker waits ~1.5s and
pings the tab (`pt/ping` → `pt/pong`). No answer means the tab left a supported
host or is still loading → state resets to `idle`. Overlapping navigation events
cancel the previous ping timer and bump a nav epoch so stale pings cannot idle a
newer visit. A state of `loading` (ingest in flight) is never reset by the ping
check.

## Extraction confidence and `ambiguous_price`

Adapters attach `ExtractionMeta` (methods, confidences, warnings, adapter
version). Price confidence is `HIGH` | `MEDIUM` | `LOW` | `AMBIGUOUS`.

When the adapter cannot confidently pick a single purchase price (conflicting
buy-box / price-block candidates), it returns `reason: "ambiguous_price"` with
`priceConfidence: "AMBIGUOUS"`. The content script sends `pt/extraction-failed`
(never `pt/observation`). The panel shows the `ambiguous` state. Nothing is
written to the API.

## Diagnostics

Footer toggle "Diagnostics" stores `pt:diagnostics` in `chrome.storage.session`
(global, not per-tab). When open, the panel shows status, retailer, external id,
adapter version, identity/price/reference methods, price confidence, warnings,
and generation. Feedback ("Looks right" / "Report issue") stays in the side
panel's `sessionStorage` only (`pt:local-feedback`); it is not sent to the API.

## Insufficient history UX

When analysis `confidence.level === "INSUFFICIENT"`, the panel shows a dedicated
learning card (observation count, today's price, first observed) and **hides**
numeric Deal Score / Discount Integrity and the stats table. History chart and
confidence block still render. This is expected for new listings; it is not an
error.

## Chart windows

Ready panels include a gap-aware history chart with window controls: **30D**,
**90D** (default), **180D**, **ALL**. The polyline does not interpolate across
missing calendar days. An accessible daily-price table is available under a
details disclosure.

## Deal Score vs Discount Integrity

These are two independent scores from the API (see `docs/SCORING.md`). The panel
never merges them.

| Surface                | Question                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Discount Integrity** | Does the store's advertised / reference discount hold up against observed history? |
| **Deal Score**         | Regardless of the advertisement, is today's price historically good?               |

Price summary still shows "STORE SAYS" (advertised discount vs reference) and
"HISTORY SAYS" (vs typical) even when confidence is insufficient for numeric
scores; advertised discount reporting is intentional and separate from score
gates.

## Privacy and permissions

| Permission / capability            | Why                                                                 |
| ---------------------------------- | ------------------------------------------------------------------- |
| `sidePanel`                        | Show the analysis panel when the toolbar action is clicked.         |
| `storage`                          | `chrome.storage.session` holds per-tab `TabState` (in-memory only). |
| `host_permissions: <API origin>/*` | Service worker calls the PriceTruth API.                            |
| `content_scripts.matches`          | Read-only DOM extraction on Amazon / Best Buy product pages.        |

Deliberately absent: `tabs`, `history`, `<all_urls>`, `cookies`, `webRequest`,
`scripting`.

The extension sends only `RetailerObservation` fields (retailer, external id,
url, title, brand/model, prices, currency, availability, variant, source,
observedAt) plus the `x-pricetruth-client-version` header. It never reads
cookies or form fields, never writes to the DOM, and collects no browsing
history. The user-agent string is hashed (sha256) server-side and never stored
raw. API requests use `credentials: "omit"`.

## Packaging

```sh
pnpm --filter @pricetruth/extension build
pnpm --filter @pricetruth/extension package        # → apps/extension/release/pricetruth-extension-<version>.zip
pnpm --filter @pricetruth/extension verify-package # zip exists; no tests/fixtures/.env/src/node_modules
```

`release/` is gitignored. Prefer `verify-package` before sharing a zip.

## Manual real-page testing

1. Start the API and DB (`pnpm --filter @pricetruth/api start`, `docker compose up -d db`).
2. Load `apps/extension/dist` unpacked and open the side panel.
3. Visit supported product pages one at a time (~8s apart; be polite).
4. Confirm a `PriceObservation` row and that
   `GET /v1/listings/<retailer>/<id>/analysis` returns 200. With few
   observations, expect `confidence: "INSUFFICIENT"` and null scores.

Known Amazon behaviors (expected, not bugs):

- Some pages show no price ("add to cart to see price", buying options walls).
  Adapter reports `no_price` / `not_product_page`; nothing is recorded.
- Sustained browsing can hit Amazon `503` pages; wait ~30s and continue. Never
  try to bypass.
- Revisits within the local dedupe window do not re-send identical observations.

Use [EXTENSION_REAL_WORLD_TEST_MATRIX.md](./EXTENSION_REAL_WORLD_TEST_MATRIX.md)
for structured daytime coverage. Do not paste live personal browsing URLs into
docs; fill matrix slots during testing sessions.
