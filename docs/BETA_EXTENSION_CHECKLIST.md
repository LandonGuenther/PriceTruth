# PriceTruth beta extension checklist

Use this before inviting 5-10 testers. Mark each item with date and initials.

Coverage key:

- **AUTO**: covered by unit/fixture tests and/or local Chrome fixture E2E (still re-check on staging builds).
- **LIVE**: requires a human on real Amazon/Best Buy PDPs (CAPTCHA, layout drift, buy-box variants).
- **OPS**: requires a real staging/production HTTPS API origin before testers can use a shipped zip.

## Install and package

- [ ] Fresh Chrome profile, Developer mode on (**LIVE**)
- [ ] Load unpacked from `apps/extension/dist` (local API) OR install production zip (**LIVE** / **OPS**)
- [x] Production zip was built with non-localhost `VITE_API_BASE_URL` (**AUTO** with placeholder; rebuild with real staging URL before testers) (**OPS**)
- [x] `pnpm --filter @pricetruth/extension verify-package` (or equivalent) passed (**AUTO**)
- [x] Manifest host_permissions show only the intended API origin (**AUTO** for placeholder origin)
- [x] No `tabs`, `history`, `cookies`, `webRequest`, or `<all_urls>` permissions (**AUTO**)

## Amazon

- [x] Visible buy-box price product: panel shows TODAY matching the buy box (**AUTO** fixture E2E; **LIVE** confirm)
- [x] Hidden / see-options price: no observation; unsupported or no-price copy (**AUTO** fixtures; **LIVE** confirm)
- [x] Per-unit price product (e.g. multipack): TODAY is pack price, not per-unit (**AUTO** fixtures; **LIVE** confirm)
- [x] Coupon-heavy PDP: coupon amount not used as purchase price (**AUTO** fixtures; **LIVE** confirm)
- [x] Installment / monthly text: monthly amount not used as purchase price (**AUTO** fixtures; **LIVE** confirm)
- [ ] Variant change (color/size): prior analysis clears; new identity loads (**LIVE**)
- [x] Product A to product B navigation: no stale A history on B (**AUTO** fixture E2E; **LIVE** confirm)
- [ ] Back/forward between products: generation/identity stays coherent (**LIVE**)

## Best Buy

- [x] Normal PDP (legacy or `/product/` URL): identity + price correct (**AUTO** fixture E2E; **LIVE** confirm)
- [x] Sale with was/regular price: reference vs current correct (**AUTO** fixtures; **LIVE** confirm)
- [x] Comp. Value present: not treated as current purchase price (**AUTO** fixtures; **LIVE** confirm)
- [x] Marketplace listing: still extracts primary product price if confident (**AUTO** fixtures; **LIVE** confirm)
- [x] Reviews sub-route: still same product identity (**AUTO** fixtures; **LIVE** confirm)
- [x] Product A to B navigation: no stale analysis (**AUTO** fixture E2E; **LIVE** confirm)

## Analysis states

- [x] Insufficient history: learning card shown; no fake scores (**AUTO** fixture E2E; **LIVE** confirm)
- [ ] High confidence listing: Deal Score and Discount Integrity both visible and separate (**LIVE** / needs history-rich listing)
- [ ] Deal high + integrity low: wording does not imply the store is fraudulent (**LIVE**)
- [x] Ambiguous price: nothing recorded; clear explanation (**AUTO** fixture E2E; **LIVE** confirm)
- [ ] API offline: error copy + retry; no stack traces (**LIVE**)
- [ ] API recovers after retry: panel reaches ready or insufficient honestly (**LIVE**)

## Accessibility and UX

- [ ] Keyboard: tab through controls, activate Retry / chart windows / feedback (**LIVE**)
- [x] Screen reader: status changes announced (live region) (**AUTO** unit coverage of `aria-live`; **LIVE** confirm with AT)
- [ ] Chart has text/table fallback (**LIVE**)
- [ ] Dark mode (system) readable if supported (**LIVE**)
- [x] Diagnostics toggle hidden by default; useful when enabled (**AUTO** unit; **LIVE** confirm)

## Privacy smoke

- [x] Network tab: only API origin requests from extension pages (**AUTO** host_permissions gate; **LIVE** confirm on staging)
- [x] Observation payload has product metadata/prices only (no cookies/DOM dumps) (**AUTO** schema/client tests; **LIVE** confirm)

## Sign-off

Tester: ________  Date: ________  Build/version: ________  Notes: ________

Do not invite external testers until **OPS** staging URL is real and remaining **LIVE** rows above are checked on that build.
