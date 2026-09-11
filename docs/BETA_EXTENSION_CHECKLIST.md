# PriceTruth beta extension checklist

Use this before inviting 5-10 testers. Mark each item with date and initials.

## Install and package

- [ ] Fresh Chrome profile, Developer mode on
- [ ] Load unpacked from `apps/extension/dist` (local API) OR install production zip
- [ ] Production zip was built with non-localhost `VITE_API_BASE_URL`
- [ ] `pnpm --filter @pricetruth/extension verify-package` (or equivalent) passed
- [ ] Manifest host_permissions show only the intended API origin
- [ ] No `tabs`, `history`, `cookies`, `webRequest`, or `<all_urls>` permissions

## Amazon

- [ ] Visible buy-box price product: panel shows TODAY matching the buy box
- [ ] Hidden / see-options price: no observation; unsupported or no-price copy
- [ ] Per-unit price product (e.g. multipack): TODAY is pack price, not per-unit
- [ ] Coupon-heavy PDP: coupon amount not used as purchase price
- [ ] Installment / monthly text: monthly amount not used as purchase price
- [ ] Variant change (color/size): prior analysis clears; new identity loads
- [ ] Product A to product B navigation: no stale A history on B
- [ ] Back/forward between products: generation/identity stays coherent

## Best Buy

- [ ] Normal PDP (legacy or `/product/` URL): identity + price correct
- [ ] Sale with was/regular price: reference vs current correct
- [ ] Comp. Value present: not treated as current purchase price
- [ ] Marketplace listing: still extracts primary product price if confident
- [ ] Reviews sub-route: still same product identity
- [ ] Product A to B navigation: no stale analysis

## Analysis states

- [ ] Insufficient history: learning card shown; no fake scores
- [ ] High confidence listing: Deal Score and Discount Integrity both visible and separate
- [ ] Deal high + integrity low: wording does not imply the store is fraudulent
- [ ] Ambiguous price: nothing recorded; clear explanation
- [ ] API offline: error copy + retry; no stack traces
- [ ] API recovers after retry: panel reaches ready or insufficient honestly

## Accessibility and UX

- [ ] Keyboard: tab through controls, activate Retry / chart windows / feedback
- [ ] Screen reader: status changes announced (live region)
- [ ] Chart has text/table fallback
- [ ] Dark mode (system) readable if supported
- [ ] Diagnostics toggle hidden by default; useful when enabled

## Privacy smoke

- [ ] Network tab: only API origin requests from extension pages
- [ ] Observation payload has product metadata/prices only (no cookies/DOM dumps)

## Sign-off

Tester: ________  Date: ________  Build/version: ________  Notes: ________
