# PriceTruth

**PriceTruth** (working name — branding constants live in `packages/shared/src/branding.ts`) is a
"price evidence" product: it answers whether an advertised discount is supported by real observed
price history. It computes two independent scores that are never merged:

- **Discount Integrity** — does the advertised markdown have historical support?
- **Deal Score** — regardless of the advertisement, is the current price historically good?

The exact scoring rules are specified in [docs/SCORING.md](docs/SCORING.md).

## Stack

- pnpm 10 workspaces monorepo, Node >= 22, TypeScript (strict, NodeNext)
- Vitest for tests, ESLint 9 flat config + Prettier
- Postgres 16 via docker compose
- Chrome MV3 extension (React + Vite) and Fastify + Prisma API

## Quickstart

```sh
docker compose up -d db   # postgres on :5432
cp .env.example .env
pnpm install
pnpm build
pnpm test
```

## Package layout

| Path                         | Package                         | Purpose                                                                                        |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/shared`            | `@pricetruth/shared`            | Branding, retailer registry, observation schema, money helpers, shared analysis response types |
| `packages/scoring`           | `@pricetruth/scoring`           | Pure, deterministic scoring per `docs/SCORING.md`; no I/O, no retailer-specific logic          |
| `packages/catalog`           | `@pricetruth/catalog`           | Pure identifier normalization + match engine per `docs/CATALOG_IDENTITY.md`                    |
| `packages/retailer-adapters` | `@pricetruth/retailer-adapters` | Pure DOM extraction of `RetailerObservation`s for Amazon/Best Buy product pages                |
| `apps/api`                   | `@pricetruth/api`               | Fastify 5 + Prisma 6 + Postgres: observation ingest, analysis, history                         |
| `apps/extension`             | `@pricetruth/extension`         | Chrome MV3 side-panel extension (React + Vite)                                                 |

## Data model in one paragraph

`PriceObservation` is an append-only fact: the observed price, a typed reference
price, provenance (`DataSource` with a trust class, schema/extractor versions),
and three timestamps (`receivedAt`, `clientObservedAt`, `effectiveAt`). Deletes
are forbidden and only `status` may change (DB-enforced; transitions are logged
in `ObservationStatusEvent`). Listings, products and variants are dimension
tables; "current price" is always derived from the newest eligible observation.

## Docs

- [docs/API.md](docs/API.md) · [docs/DATA_MODEL.md](docs/DATA_MODEL.md) ·
  [docs/SCORING.md](docs/SCORING.md) · [docs/EXTENSION.md](docs/EXTENSION.md) ·
  [docs/PRIVACY.md](docs/PRIVACY.md) · [docs/CATALOG_IDENTITY.md](docs/CATALOG_IDENTITY.md) ·
  [docs/DATA_QUALITY.md](docs/DATA_QUALITY.md)
- ADRs: [observation immutability](docs/adr/ADR-001-observation-immutability.md) ·
  [identifiers & types](docs/adr/ADR-002-identifiers-and-database-types.md) ·
  [provenance](docs/adr/ADR-003-provenance.md) ·
  [client vs server time](docs/adr/ADR-004-client-time-vs-server-time.md) ·
  [catalog identity](docs/adr/ADR-005-catalog-identity.md) ·
  [data quality](docs/adr/ADR-006-data-quality.md)
- Migration notes: [docs/migrations/2026-09-data-foundation.md](docs/migrations/2026-09-data-foundation.md)

### API quickstart

```sh
docker compose up -d db
cp .env.example .env
pnpm --filter @pricetruth/api db:migrate   # apply migrations
pnpm --filter @pricetruth/api db:seed      # seed retailers (idempotent; also lazy)
pnpm --filter @pricetruth/api start        # serves on 127.0.0.1:3000
```

### Extension quickstart

```sh
pnpm --filter @pricetruth/extension build    # → apps/extension/dist
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
pnpm --filter @pricetruth/extension package  # zips dist → release/
```
