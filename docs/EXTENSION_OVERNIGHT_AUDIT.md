# Extension overnight audit

Date: 2026-09-11  
Scope: `apps/extension/**`, `packages/retailer-adapters/**`  
Out of scope: API/Prisma/scoring architecture (owned by parallel backend work)

## Baseline (pre-change)

| Check            | Result                                                                         |
| ---------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`      | pass                                                                           |
| `pnpm typecheck` | pass                                                                           |
| `pnpm test`      | pass (shared 13, scoring 34, retailer-adapters 79, extension 24, api 14)       |
| `pnpm build`     | pass                                                                           |
| Bundle           | content ~68KB, service-worker ~4KB, sidepanel ~148KB + observation chunk ~56KB |

## Architecture snapshot

```
content script (observer + adapters)
  → chrome.runtime messages (pt/observation | pt/extraction-failed)
service worker (handler + ApiClient)
  → POST /v1/observations, GET analysis + history
  → chrome.storage.session[tab:<id>]
side panel (useTabState → Panel)
```

Permissions stay minimal: `sidePanel`, `storage`, API host only. No `tabs` / `history` / `<all_urls>` / cookies / webRequest / scripting.

## Findings (priority order)

### P0 – Correctness / stale state

1. **No generation / identity token on ingest.** Concurrent `pt/observation` (variant A then B) can let a slower analysis for A overwrite ready state for B. Users can briefly (or permanently until next extract) see Product A history on Product B.
2. **Same-URL extraction failure after success is sticky.** `failedUrls` suppresses repeat failure notices; if price disappears after a ready state, the panel can keep showing stale ready data.
3. **Overlapping navigation pings.** Each `tabs.onUpdated` `loading` schedules a 1.5s ping with no cancellation; interleaved leave/enter can flicker idle.

### P1 – Extraction reliability

4. **Amazon price selectors are document-global.** `.a-price-whole` / `.a-price-fraction` and several `.a-offscreen` queries are not scoped to the buy box; carousel / sponsored / used / subscription modules can win.
5. **No extraction confidence.** Ambiguous multi-price pages still submit observations. Safer behavior: withhold ingest when price confidence is LOW/AMBIGUOUS.
6. **Fixture coverage is thin for adversarial layouts.** Missing: coupon-only, installment, used offer, subscription, twister variant switch, smile subdomain, JSON-LD-only Amazon, Best Buy Comp. Value-only, SKU mismatch, reviews-without-price, marketplace seller badge.

### P2 – Navigation / observer

7. **MutationObserver watches all of `document.body`.** Debounced (1.5s) and signature-deduped (10 min), but still fires on unrelated widgets; no attribute filter; no ignore list for extension-owned nodes (n/a today since we do not inject DOM).
8. **URL poll is 1s.** Fine for SPA variant switches; should reset failure cache and in-flight generation on identity change.

### P3 – UX

9. **Panel states are coarse:** idle / unsupported / loading / ready / error. Missing explicit: non-product-on-supported-host, ambiguous price, network vs API vs malformed, insufficient-history as first-class surface (partially covered by confidence banner).
10. **Insufficient history** is a small notice; should be a dedicated, intentional panel section (no fake scores). Already hides numeric scores when INSUFFICIENT  -  keep that invariant.
11. **History chart** has no 30/90/180/ALL window control; draws continuous polyline across gaps (implies observations on missing days).
12. **Reason strings** are raw backend prose; no client-side reason-code map / graceful unknown handling.
13. **No diagnostics mode** for adapter method, warnings, API reachability, panel state.
14. **Ingest accepted/duplicate** stored but never shown (optional, low priority).

### P4 – Tests

15. Handler lacks stale-overwrite / generation-token tests.
16. Observer lacks burst-mutation and identity-change failure-cache-reset tests.
17. Panel lacks coverage for every status + insufficient + malformed analysis + HTML-ish titles.
18. Adapters need fixture-per-bug discipline for the layouts above.

### P5 – Accessibility

19. Chart is an SVG with a generic `aria-label`; no data table / screen-reader summary.
20. Loading/error transitions do not use an `aria-live` region.
21. Focus styles / keyboard path for Retry are untested; contrast relies on light theme only (no `prefers-color-scheme` yet).

### P6 – Performance

22. Side panel ships React + full observation chunk (~200KB combined). Acceptable for MV3; watch for chart/window state additions.
23. Observer: measure callback rate under fixture mutation storms after debounce changes.

### P7 – Diagnostics / privacy / security

24. Privacy posture is strong (session storage, omit credentials, no DOM write, narrow matches). Preserve it.
25. Titles rendered as React text (safe). No `dangerouslySetInnerHTML` today  -  keep the grep clean.
26. Package script zips all of `dist/`; verify no tests/fixtures/.env leak into the zip (dist should be build output only).

### P8 – Packaging / CI / docs

27. CI already runs lint, format, typecheck, test, build. Add extension package verification (zip exists, no forbidden paths).
28. Docs: EXTENSION.md is solid; need architecture / QA / performance / overnight report / real-world matrix.

## Non-goals tonight

- Prisma schema, migrations, observationService, analysisService, scoring math
- New host permissions or retailer sites beyond Amazon + Best Buy
- Live retailer hammering
- Backend response shape redesign (consume current AnalysisResponse / HistoryResponse)

## Fix plan (execution order)

1. Formal panel state model + generation tokens in handler
2. Observer identity-change resets + mutation debounce hardening
3. Adapter confidence + scoped Amazon/Best Buy extraction + fixtures
4. Panel UX: insufficient, chart windows, reason map, diagnostics, feedback
5. API client error taxonomy + timeouts (no retry storms)
6. A11y live regions + chart summary; light dark-mode tokens if cheap
7. Tests, packaging gate, docs, overnight report
