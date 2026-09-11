# Extension architecture

## Pieces

- `apps/extension/src/content` - retailer DOM extraction via `@pricetruth/retailer-adapters`
- `apps/extension/src/background` - service worker, `ApiClient`, tab state machine
- `apps/extension/src/sidepanel` - React panel
- `packages/retailer-adapters` - Amazon + Best Buy extractors + fixtures

## Data flow

1. Content script observes URL + DOM (debounced).
2. Adapter returns observation or failure (`no_price`, `ambiguous_price`, ...).
3. Background bumps a per-tab generation, posts observation, fetches analysis + history.
4. Results write to `chrome.storage.session` under `tab:<id>` only if generation still matches.
5. Side panel listens to session storage and renders.

## Privacy posture

Permissions: `sidePanel`, `storage`, single API `host_permission`.
No `tabs` / `history` / `cookies` / `webRequest` / `<all_urls>`.
Navigation reset uses content-script ping, not URL reading.

## API client

All network I/O goes through `ApiClient` (timeouts, client version header, response parsing).
React never calls `fetch` directly.
Unknown JSON fields are ignored; required fields are validated.
Optional `x-pricetruth-api-version` major > client schema yields `unsupported_version`.

## Stale response defense

`generation` increments on identity change / retry / ambiguous failure.
In-flight work checks generation before writing `ready` or `error`.
Overlapping `tabs.onUpdated` loading events cancel prior ping timers.
