# Migrations

Status: IMPLEMENTED

Schema lives in `apps/api/prisma/schema.prisma`; applied migrations in
`apps/api/prisma/migrations/` (never edit an applied migration).

## Workflow

1. Edit `schema.prisma` (additive preferred — see API_COMPATIBILITY rules).
2. Generate SQL: `prisma migrate dev --create-only --name <slug>` on a clean
   dev DB, or when the dev DB has drift:
   `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <empty-db> --script > prisma/migrations/<ts>_<slug>/migration.sql`.
3. **Review the SQL** — check it is additive (ALTER/CREATE only), that no
   unintended NOT NULL lands on a large table without default, and that index
   creation on big tables uses `CONCURRENTLY` equivalents where needed
   (Prisma-generated index DDL is a plain `CREATE INDEX`; on >1M-row tables
   convert to `CREATE INDEX CONCURRENTLY` and run it outside `migrate deploy`).
4. Apply locally: `pnpm --filter @pricetruth/api db:migrate` (=
   `migrate deploy`).
5. CI replays every migration against a shadow database and diffs the result
   against the schema (`prisma migrate diff --from-migrations --to-schema-
datamodel --shadow-database-url … --exit-code`) — drift fails the build.
6. `test/migration.test.ts` verifies both a fresh deploy and an upgrade path
   (Path A/B).

## Backfills

Data backfills are their own migration (`*_model_backfill` pattern) or an idempotent
script under `apps/api/scripts/` run after deploy. Never mix DDL and large
backfills in one migration.

## Rollback

`migrate deploy` is forward-only. To back out, write a new migration reversing
the change. For catastrophic cases restore from backup
(docs/BACKUP_RESTORE.md).

## Current migration list

See `test/migration.test.ts` (the Path A list is the canonical enumeration).
