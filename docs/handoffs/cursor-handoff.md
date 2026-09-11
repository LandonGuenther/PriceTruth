# Cursor handoff - public beta extension

## BASE MAIN SHA

`5e9dd67d50e84a16a0a4e0437204b83220e6a29d`

## Branch

`cursor/public-beta-extension`

## Ownership

Cursor owns: `apps/extension/**`, `packages/retailer-adapters/**`, extension packaging, extension docs/QA.

Devin owns: `apps/api/**`, Prisma, workers, data platform, `packages/scoring/**`, catalog identity.

## Baseline (from main)

| Gate | Extension / adapters | Full monorepo |
| --- | --- | --- |
| lint | pass | pass |
| typecheck | pass (`@pricetruth/extension`, `@pricetruth/retailer-adapters`) | **FAIL** in `apps/api` (Prisma client missing `ObservationStatus`, `PriceType`, `listingVariant`, `dataSource`, `effectiveAt`, `status`, etc.) |
| test | extension 24, retailer-adapters 92 | **FAIL** in `apps/api` integration tests (same schema drift) |
| build | extension pass | **FAIL** in `apps/api` |

These API/Prisma failures are **out of Cursor ownership**. Documented here for Devin; Cursor continues on extension/adapters only.

## Backend changes requested (do not implement in Cursor)

None required to unblock extension work yet. After Devin merges:

1. Confirm production API origin and CORS allowlist for the extension ID / packaged origin model (MV3 extension pages).
2. Confirm `/v1/observations`, `/v1/listings/:retailer/:id/analysis`, `/v1/listings/:retailer/:id/history` remain additive-compatible with `AnalysisResponse` / `HistoryResponse` in `@pricetruth/shared`.
3. If Devin renames fields (forbidden by contract) or removes `evidence` / `effectiveAt`, tell Cursor before merge so the extension client validators can adapt.

## Shared types

Cursor will avoid editing `packages/shared` unless a compile break forces a tiny additive export. Prefer extension-local parsers that accept unknown extra JSON fields.

## Status

Work in progress. This file will be updated with HEAD SHA, test totals, fixture totals, bundle size, P0/P1/P2, and post-Devin rebase steps before PR.
