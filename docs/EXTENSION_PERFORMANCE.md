# Extension performance

Measured on 2026-09-11 after `pnpm --filter @pricetruth/extension build` in this
environment. Re-run the commands below when comparing PRs; hashes in asset
filenames change per build.

## Bundle sizes (dist)

| Artifact                                       | Bytes (approx)    | Notes                             |
| ---------------------------------------------- | ----------------- | --------------------------------- |
| `content.js`                                   | 73,753 (~72 KB)   | Content script + inlined adapters |
| `service-worker.js`                            | 7,023 (~7 KB)     | Handler + API client chunk        |
| `sidepanel.js`                                 | 159,431 (~156 KB) | React panel bundle                |
| `assets/observation-*.js`                      | 54,773 (~53 KB)   | Shared observation/schema chunk   |
| `assets/sidepanel-*.css`                       | 4,975 (~5 KB)     | Panel styles                      |
| `dist/` total (`du -h`)                        | ~336 KB           | Includes icons + manifest         |
| Release zip (`pricetruth-extension-0.1.0.zip`) | 88,860 (~87 KB)   | `pnpm package` output             |

Commands used:

```sh
pnpm --filter @pricetruth/extension build
du -h apps/extension/dist
ls -la apps/extension/dist apps/extension/dist/assets
pnpm --filter @pricetruth/extension package
pnpm --filter @pricetruth/extension verify-package
du -h apps/extension/release/*
```

Gzip sizes reported by Vite at build time (informative): content ~18.6 KB,
service-worker ~2.6 KB, sidepanel ~51 KB, observation chunk ~12.6 KB.

## Runtime timers and caps

| Constant              | Value          | Where                                   | Purpose                                |
| --------------------- | -------------- | --------------------------------------- | -------------------------------------- |
| Mutation debounce     | **1500 ms**    | `observer.ts` `MUTATION_DEBOUNCE_MS`    | Coalesce DOM churn before re-extract   |
| URL poll              | **1000 ms**    | `observer.ts` `URL_POLL_MS`             | Detect pushState / variant URL changes |
| Local dedupe window   | **10 minutes** | `observer.ts` `LOCAL_DEDUPE_MS`         | Do not re-send identical signature     |
| Navigation ping delay | **1500 ms**    | `handler.ts` `NAVIGATION_PING_DELAY_MS` | Wait for content script after load     |
| API timeout           | **10 seconds** | `api.ts` `TIMEOUT_MS`                   | AbortController per request            |

## No auto-retry storms

- `ApiClient.request` performs **one** attempt per call. Failures throw;
  Vitest asserts failed requests are not retried.
- Observer signature + 10m dedupe prevent mutation storms from flooding the
  service worker / API.
- Mutation relevance filtering reduces callbacks from unrelated page chrome.
- Panel Retry is explicit user action only.
- Overlapping navigation pings cancel prior timers (no piled-up idle writes).

## Watch items

- Side panel + observation chunk together are ~200 KB uncompressed JS. Acceptable
  for MV3; avoid pulling large chart libraries.
- Content script size is dominated by retailer adapters + shared parsers. Prefer
  fixture-driven selector fixes over shipping extra HTML snapshots in the
  bundle (fixtures stay in the adapters package tests only).
- After debounce / filter changes, re-check observer tests for mutation-burst
  behavior and spot-check a live product page for extract latency.
