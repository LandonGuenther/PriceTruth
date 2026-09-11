# Cursor handoff - public beta extension

## BASE MAIN SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

## CURSOR HEAD SHA

`f4ed15f11e58901a430b76c2fcc92725715a0bac` (docs/package commits may follow)

## Branch

`cursor/public-beta-extension`

## Owned / changed

- `apps/extension/**` (state machine, API client validation, production package gate, panel UX, diagnostics, feedback, a11y)
- `packages/retailer-adapters/**` (`ambiguous_price`, unit-price / Comp. Value / financing fixtures)
- `docs/EXTENSION.md`, `docs/EXTENSION_ARCHITECTURE.md`, `docs/EXTENSION_QA.md`, `docs/EXTENSION_PERFORMANCE.md`
- `docs/BETA_EXTENSION_CHECKLIST.md`, `docs/EXTENSION_REAL_WORLD_TEST_MATRIX.md`
- `docs/handoffs/cursor-handoff.md`

## API assumptions

- `POST /v1/observations`
- `GET /v1/listings/:retailer/:externalId/analysis`
- `GET /v1/listings/:retailer/:externalId/history`
- Additive unknown JSON fields are tolerated
- Existing field names are not renamed by this branch
- Optional response header `x-pricetruth-api-version` (major)

## Shared types touched

None intentionally. Extension-local parsers wrap `@pricetruth/shared` response types.

## Backend changes requested

1. Publish the production API origin for packaging (`VITE_API_BASE_URL`).
2. Confirm CORS allows the Chrome extension origin model used in MV3.
3. Keep analysis/history response fields additive-compatible through Devin merge.
4. Monorepo `apps/api` typecheck/test currently fails on main from Prisma client drift (`ObservationStatus`, `effectiveAt`, etc.). That is Devin-owned; Cursor did not patch it.

## Production API integration status

Package gate is ready. Production URL is not hard-coded. Waiting on Devin handoff for the real origin before a testers zip is cut.

## Test totals (this branch)

- Extension: 48 passed
- Retailer adapters: 115 passed
- Amazon fixtures: 23
- Best Buy fixtures: 15

## Bundle / package

- content ~73KB, service-worker ~10KB, sidepanel ~158KB
- verified zip ~90KB, 12 entries, no tests/fixtures/src/node_modules

## Known issues

### P0

- None known in extension-owned code after local green runs.

### P1

- Live Amazon visible buy-box confirmation still needs daytime manual pass (pages often hide price in automation).
- Full monorepo typecheck/test red on main due to API/Prisma drift (blocks whole-repo CI until Devin lands).
- Production API URL unknown until backend deploy docs arrive.

### P2

- Real-world matrix rows are empty placeholders for daytime filling.
- Optional Chrome fixture E2E harness can be expanded further; CI stays fixture/unit based.

## Exact steps after Devin merges

1. Wait for Devin/backend PR to merge to `main`.
2. `git fetch origin main && git checkout cursor/public-beta-extension && git rebase origin/main`
3. Fix any additive API/type mismatches in `apps/extension/src/background/api.ts` parsers only.
4. Run `pnpm --filter @pricetruth/extension typecheck test build`
5. Run `pnpm --filter @pricetruth/retailer-adapters typecheck test`
6. If whole-repo gates are green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
7. Build testers zip with the real origin:
   `VITE_API_BASE_URL=<prod-origin> pnpm --filter @pricetruth/extension build && VITE_API_BASE_URL=<prod-origin> pnpm --filter @pricetruth/extension package && pnpm --filter @pricetruth/extension verify-package`
8. Do not merge this PR until steps 1-6 succeed.

## Do not merge order

Devin first, Cursor rebase second, then Cursor merge.
