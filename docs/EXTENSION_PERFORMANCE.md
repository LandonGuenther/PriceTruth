# Extension performance notes

Measured on this branch after production-shaped build (`VITE_API_BASE_URL=https://api.example.com`):

| Artifact | Approx size |
| --- | --- |
| `content.js` | ~73 KB (~19 KB gzip) |
| `service-worker.js` | ~10 KB (~3.5 KB gzip) |
| `sidepanel.js` | ~158 KB (~51 KB gzip) |
| release zip | ~90 KB |

## Runtime budgets (design)

- Mutation observer: debounced (~1.5s), signature-deduped (~10 min)
- URL poll: ~1s for pushState navigations
- API timeout: 10s, no automatic retry storms
- One observation ingest + analysis + history per accepted extraction (not per mutation)

## Chart

SVG path with explicit gaps (no false continuous interpolation). Window filters are client-side on already-fetched daily points.
