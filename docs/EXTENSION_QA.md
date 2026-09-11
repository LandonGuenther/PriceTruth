# Extension QA

## Automated

```sh
pnpm --filter @pricetruth/extension typecheck test build
pnpm --filter @pricetruth/retailer-adapters typecheck test
```

Coverage focus: handler generation races, ambiguous price, API malformation/timeouts, production URL package gate, panel insufficient/ambiguous/feedback/diagnostics, Amazon unit-price and Best Buy Comp. Value fixtures.

## Manual

See `docs/BETA_EXTENSION_CHECKLIST.md` and `docs/EXTENSION_REAL_WORLD_TEST_MATRIX.md`.

Live retailer E2E is daytime-only and polite. CI must not call Amazon/Best Buy.

## Runtime E2E skill

Use the repository runtime E2E skill for controlled Chrome + fixture flows. Prefer fixtures over live pages for regression.
