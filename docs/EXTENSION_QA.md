# Extension QA

## How to run automated tests

From repo root:

```sh
# Extension unit/integration tests (Vitest)
pnpm --filter @pricetruth/extension test

# Retailer adapter fixtures (extracted DOM HTML)
pnpm --filter @pricetruth/retailer-adapters test

# Full monorepo gate (includes extension + adapters)
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Packaging gate (after build):

```sh
pnpm --filter @pricetruth/extension package
pnpm --filter @pricetruth/extension verify-package
```

## Automated test inventory

### `@pricetruth/extension`

| File                                 | Focus                                                                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/background/handler.test.ts`     | Success → ready; API/timeout errors; unsupported; `ambiguous_price`; duplicate ingest; retry; **stale generation cannot overwrite newer ready**; navigation ping idle/preserve/loading; overlapping nav cancel |
| `src/background/api.test.ts`         | Unbound-safe fetch; ApiError; malformed JSON; unsupported API version; client version header; **no retry on failure**; response parsers                                                                        |
| `src/content/observer.test.ts`       | Bootstrap send; identical churn; mutation burst once; URL/ASIN change; price change; not_product_page once; failure once per URL; identity change clears failure cache; ambiguous never posts observation      |
| `src/content/mutation.test.ts`       | Relevant price/title/sku markers; ignore nav/footer; text-node parent walk                                                                                                                                     |
| `src/sidepanel/panel.test.tsx`       | Ready labels/scores; **INSUFFICIENT hides scores**; idle/unsupported/ambiguous/error/loading phases; HTML-like titles as text; unknown reasons; diagnostics + feedback controls                                |
| `src/sidepanel/useTabState.test.tsx` | Initial tab state; session `onChanged` re-render                                                                                                                                                               |
| `src/sidepanel/copy.test.ts`         | Forbidden-word guard; reason humanization                                                                                                                                                                      |

### `@pricetruth/retailer-adapters` (extension-critical)

| File                      | Focus                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `amazon/amazon.test.ts`   | URL match; extract happy paths; conflicting buy-box → `ambiguous_price`; scoped selectors; fixtures |
| `bestbuy/bestbuy.test.ts` | Legacy + `/product/` URLs; SKU authority; conflict → `ambiguous_price`; price-block scoping         |
| `extraction-meta.test.ts` | Confidence fields HIGH/MEDIUM/LOW/AMBIGUOUS across adapters                                         |

Fixture HTML lives under `packages/retailer-adapters` (not shipped in the zip;
`verify-package` forbids fixture paths).

## Manual QA checklist

### Setup

1. `docker compose up -d db` and start API against `VITE_API_BASE_URL`.
2. `pnpm --filter @pricetruth/extension build`
3. Load unpacked `apps/extension/dist`; open side panel via toolbar action.

### Happy path

- [ ] Amazon `/dp/<ASIN>` → loading (submitting → analyzing) → ready
- [ ] Best Buy `/product/...` and legacy `/site/...p` → ready
- [ ] Product title, identifier label, TODAY price match the page
- [ ] STORE SAYS / HISTORY SAYS lines present
- [ ] Diagnostics shows adapter methods and generation

### Insufficient history

- [ ] New listing shows learning card copy ("still learning")
- [ ] Numeric Deal Score / Discount Integrity **hidden** (not fake zeros)
- [ ] Chart may still render if history endpoint returns daily points
- [ ] Confidence block shows Insufficient

### Ambiguous price

- [ ] Layout with conflicting in-buy-box / price-block candidates → panel
      `ambiguous` (or fixture-backed adapter failure)
- [ ] No new observation row in the API
- [ ] Diagnostics shows `AMBIGUOUS` price confidence when meta is present

### Unsupported / non-product

- [ ] Amazon home or search on matched host → unsupported / not_product_page
- [ ] Product page with no purchase price wall → `no_price` messaging
- [ ] Navigating away from supported host → idle after ping delay

### Error paths

- [ ] Stop API → network/unreachable error + Retry
- [ ] Retry after API returns → recovers to ready when possible
- [ ] Malformed / unexpected API body surfaces update-extension style message
      (covered primarily by unit tests; force via mock if needed)

### Navigation / identity

- [ ] Switch ASIN / SKU via in-page variant (URL change) → new loading, not
      stale previous product scores
- [ ] Rapid back/forward does not leave wrong-product ready state
- [ ] Amazon ghost `loading` events do not wipe a ready panel

### Chart and scores

- [ ] 30D / 90D / 180D / ALL controls change the visible series
- [ ] Gaps in daily points do not draw a continuous line across missing days
- [ ] With sufficient confidence, Deal Score and Discount Integrity both show
      and remain visually separate

### Privacy smoke

- [ ] Chrome permission UI shows only side panel + storage + API host
- [ ] No request cookies on API calls (Network: credentials omit)
- [ ] Feedback "Report issue" does not create an API call

## Real-world matrix

Daytime testers: fill
[EXTENSION_REAL_WORLD_TEST_MATRIX.md](./EXTENSION_REAL_WORLD_TEST_MATRIX.md).
Prefer ~8s between live page loads. Capture failing DOM as adapter fixtures;
link the fix commit in the matrix.
