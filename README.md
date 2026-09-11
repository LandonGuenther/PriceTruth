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
- Chrome extension + API (added in later phases)

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
| `packages/retailer-adapters` | `@pricetruth/retailer-adapters` | Pure DOM extraction of `RetailerObservation`s for Amazon/Best Buy product pages                |
| `apps/api`                   | `@pricetruth/api`               | Fastify 5 + Prisma 6 + Postgres: observation ingest, analysis, history                         |
| `apps/*`                     | —                               | Chrome extension (later phase)                                                                 |

See also: [docs/API.md](docs/API.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

### API quickstart

```sh
docker compose up -d db
cp .env.example .env
pnpm --filter @pricetruth/api db:migrate   # apply migrations
pnpm --filter @pricetruth/api db:seed      # seed retailers (idempotent; also lazy)
pnpm --filter @pricetruth/api start        # serves on 127.0.0.1:3000
```
