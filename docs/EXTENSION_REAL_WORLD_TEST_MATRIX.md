# Extension real-world test matrix

Empty slots for daytime testers. **Do not invent live product URLs in this file
from personal browsing history.** Paste URLs only while actively testing, or
leave URL blank and note the identifier.

Related: [EXTENSION_QA.md](./EXTENSION_QA.md), [EXTENSION.md](./EXTENSION.md).

## Instructions for daytime testers

1. Build and load unpacked: `pnpm --filter @pricetruth/extension build`, then
   Chrome → Developer mode → Load unpacked → `apps/extension/dist`.
2. Ensure API + DB are up and `VITE_API_BASE_URL` matches the running API.
3. Open the side panel before visiting product pages.
4. Space live page loads by ~8 seconds. If Amazon returns 503, wait ~30s; never
   bypass blocks.
5. For each slot, fill columns from what you see on the page vs the panel.
6. Use slot ids like `AMAZON-014` / `BESTBUY-003` in bug titles.
7. On failure: save a minimized HTML fixture under retailer-adapters tests (no
   PII), open a fix PR, and record the fix commit SHA in **Fixed commit**.
8. Mark booleans as `Y` / `N` / `n/a`. **Panel result** examples: `ready`,
   `ready/insufficient`, `ambiguous`, `unsupported/no_price`, `error/network`,
   `idle`.
9. Prefer public category labels only (e.g. `tv`, `laptop`, `headphones`). Skip
   accounts, wishlists, or anything that exposes personal data.

Column meanings:

| Column            | What to record                                            |
| ----------------- | --------------------------------------------------------- |
| URL               | Product URL used (optional until test time)               |
| Identifier        | ASIN or Best Buy SKU                                      |
| Category          | Short product category                                    |
| Price correct     | Panel TODAY matches buy-box / purchase price              |
| Reference correct | Store reference / list / Comp. Value matches when present |
| Stock             | Availability extraction looks right                       |
| Variant           | Color/size/SKU matches selected variant                   |
| Identity          | Correct ASIN/SKU (not carousel neighbor)                  |
| Warnings          | Diagnostics warnings or empty                             |
| Panel result      | Final TabState / UX outcome                               |
| Issue             | Short note or ticket id                                   |
| Fixture created   | `Y` + fixture name, or blank                              |
| Fixed commit      | Short SHA when resolved                                   |

Totals: **50 Amazon + 50 Best Buy = 100 slots**.

## Amazon (50)

| Slot       | URL | Identifier | Category | Price correct | Reference correct | Stock | Variant | Identity | Warnings | Panel result | Issue | Fixture created | Fixed commit |
| ---------- | --- | ---------- | -------- | ------------- | ----------------- | ----- | ------- | -------- | -------- | ------------ | ----- | --------------- | ------------ |
| AMAZON-001 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-002 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-003 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-004 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-005 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-006 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-007 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-008 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-009 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-010 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-011 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-012 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-013 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-014 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-015 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-016 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-017 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-018 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-019 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-020 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-021 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-022 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-023 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-024 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-025 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-026 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-027 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-028 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-029 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-030 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-031 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-032 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-033 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-034 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-035 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-036 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-037 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-038 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-039 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-040 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-041 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-042 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-043 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-044 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-045 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-046 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-047 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-048 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-049 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| AMAZON-050 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |

## Best Buy (50)

| Slot        | URL | Identifier | Category | Price correct | Reference correct | Stock | Variant | Identity | Warnings | Panel result | Issue | Fixture created | Fixed commit |
| ----------- | --- | ---------- | -------- | ------------- | ----------------- | ----- | ------- | -------- | -------- | ------------ | ----- | --------------- | ------------ |
| BESTBUY-001 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-002 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-003 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-004 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-005 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-006 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-007 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-008 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-009 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-010 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-011 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-012 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-013 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-014 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-015 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-016 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-017 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-018 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-019 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-020 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-021 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-022 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-023 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-024 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-025 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-026 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-027 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-028 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-029 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-030 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-031 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-032 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-033 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-034 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-035 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-036 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-037 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-038 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-039 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-040 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-041 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-042 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-043 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-044 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-045 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-046 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-047 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-048 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-049 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
| BESTBUY-050 |     |            |          |               |                   |       |         |          |          |              |       |                 |              |
