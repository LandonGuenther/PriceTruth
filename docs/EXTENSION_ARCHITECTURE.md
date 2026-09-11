# Extension architecture

Scope: `apps/extension` and its boundary with `@pricetruth/retailer-adapters` /
`@pricetruth/shared`. Backend scoring and Prisma are out of scope here (see
`docs/API.md`, `docs/SCORING.md`).

## Components

```
┌─────────────────────────────┐
│ Content script              │
│  observer + MutationObserver│
│  findAdapter().extract()    │
└──────────────┬──────────────┘
               │ RuntimeMessage
               ▼
┌─────────────────────────────┐
│ Service worker              │
│  handler + ApiClient        │
│  chrome.storage.session     │
└──────────────┬──────────────┘
               │ session keys
               ▼
┌─────────────────────────────┐
│ Side panel (React)          │
│  useTabState → Panel        │
└─────────────────────────────┘
```

| Piece           | Entry                                           | Role                                                              |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Content script  | `src/content/index.ts`                          | Start observer; answer `pt/ping`.                                 |
| Observer        | `src/content/observer.ts`                       | URL poll + debounced DOM extract; send observations / failures.   |
| Mutation filter | `src/content/mutationRelevance.ts`              | Ignore unrelated chrome; prefer price/title/identity nodes.       |
| Service worker  | `src/background/service-worker.ts`              | Wire Chrome APIs to handler + ApiClient.                          |
| Handler         | `src/background/handler.ts`                     | TabState transitions, generation tokens, navigation pings.        |
| API client      | `src/background/api.ts`                         | POST observation, GET analysis/history; timeouts; parse/validate. |
| Messages        | `src/messages.ts`                               | Shared message and TabState types.                                |
| Side panel      | `src/sidepanel/*`                               | Render TabState; diagnostics; chart; feedback.                    |
| Manifest        | `src/manifest.ts` + `scripts/write-manifest.ts` | MV3 manifest with API origin substituted at build.                |

## Content script observer

`startObserver`:

1. Runs an initial extract immediately.
2. Polls `location.href` every **1000ms**. On change, clears failure-cache entries
   for the old and new URL, resets the last signature, and re-extracts (SPA /
   twister variant switches).
3. Subscribes to DOM mutations via `observeDomMutations`. The production wiring
   filters with `mutationLooksRelevant` and an `attributeFilter` of
   `class`, `data-asin`, `data-sku-id`, `data-testid`, `style`. Callbacks are
   debounced **1500ms**.
4. Signature = `JSON.stringify([externalId, priceCents, referencePriceCents])`.
   Identical results are not re-sent. Identical signatures are also suppressed
   within a **10 minute** local dedupe window after a successful send.
5. Failures (`!result.ok`) are sent once per URL via `failedUrls` until identity
   change clears the cache. Success path does not consult `failedUrls`.

Ambiguous prices never become `pt/observation`; they are always
`pt/extraction-failed` with `reason: "ambiguous_price"`.

## Service worker handler

`handleMessage` / `handleNavigationStart`:

- `pt/observation` → bump generation → `loading` (`submitting`) → POST →
  `loading` (`analyzing`) → parallel GET analysis + history → `ready` (or
  `error`). Abandon if generation changed mid-flight.
- `pt/extraction-failed` + `ambiguous_price` → `ambiguous` (no ingest).
- Other extraction failures → `unsupported` with reason.
- `pt/retry` → re-run stored observation from `error` / `ready` / `loading`.
- Navigation `loading` → cancel prior ping timer → wait 1500ms → ping. Dead
  content script and non-loading prior state → `idle` + generation bump.
  In-flight `loading` ingest is left alone.

`pt/set-diagnostics` exists on the message union for future use; the panel today
toggles `pt:diagnostics` directly in session storage.

## Side panel

- `useTabState` reads `tab:<id>` for the active tab (`chrome.tabs.query` without
  reading `tab.url`) and listens to `storage.session.onChanged`.
- `Panel` switches on `TabState.status`. Ready + `INSUFFICIENT` shows
  `InsufficientCard` and hides score/stats bodies.
- `HistoryChart` filters daily points by 30/90/180/ALL windows (client-side).
- Titles and reasons render as React text only (no `dangerouslySetInnerHTML`).

## Messaging types

Defined in `apps/extension/src/messages.ts`.

**Content → background**

| Type                   | Payload highlights                                                        |
| ---------------------- | ------------------------------------------------------------------------- |
| `pt/observation`       | `observation: RetailerObservation`, optional `extraction: ExtractionMeta` |
| `pt/extraction-failed` | `retailer`, `reason`, `url`, `warnings`, optional `extraction`            |

Failure reasons: `not_product_page` | `no_identifier` | `no_price` | `invalid` |
`ambiguous_price`.

**Panel → background**

| Type                 | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `pt/retry`           | `{ tabId }` re-run last observation              |
| `pt/set-diagnostics` | `{ enabled }` reserved; panel uses storage today |

**Background ↔ content**

| Type      | Purpose                               |
| --------- | ------------------------------------- |
| `pt/ping` | Liveness probe                        |
| `pt/pong` | Synchronous reply from content script |

## Storage keys

| Key                 | Area                        | Lifetime / notes                                 |
| ------------------- | --------------------------- | ------------------------------------------------ |
| `tab:<tabId>`       | `chrome.storage.session`    | Per-tab `TabState`. Cleared on `tabs.onRemoved`. |
| `pt:diagnostics`    | `chrome.storage.session`    | Global diagnostics toggle.                       |
| `pt:local-feedback` | Side-panel `sessionStorage` | Last ~20 local feedback payloads; not uploaded.  |

Nothing is written to `chrome.storage.local` or disk by the extension runtime.

## Retailer adapters boundary

- Package: `@pricetruth/retailer-adapters`.
- Content script calls `findAdapter(url)` then `adapter.extract(doc, url, now)`.
- Adapters own URL matching, selector scoping, `ExtractionMeta`, and failure
  reasons. Extension code must not scrape retailer DOM outside adapters.
- Shared observation shape comes from `@pricetruth/shared` (`RetailerObservation`).
- Adding a retailer means: adapter + fixtures + `content_scripts.matches` entry
  in the manifest. Do not broaden to `<all_urls>`.

## API client

`ApiClient` (`src/background/api.ts`):

| Call              | Path                                                        |
| ----------------- | ----------------------------------------------------------- |
| `postObservation` | `POST /v1/observations`                                     |
| `getAnalysis`     | `GET /v1/listings/:retailer/:id/analysis`                   |
| `getHistory`      | `GET /v1/listings/:retailer/:id/history?days=180` (default) |

Behavior:

- 10s abort timeout → `ApiTimeoutError`
- Non-2xx → `ApiError`
- Non-JSON / missing required fields → `ApiMalformedError`
- Optional `x-pricetruth-api-version` / `schemaVersion` ahead of client →
  `ApiUnsupportedVersionError`
- `credentials: "omit"`; sends `x-pricetruth-client-version`
- **No automatic retries** (avoids storms on flaky networks)

Handler maps those errors to TabState `error.kind`: `network` | `api` |
`timeout` | `unknown`.
