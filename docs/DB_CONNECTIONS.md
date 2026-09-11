# Database connections

Status: IMPLEMENTED

Single Postgres 16 container from `docker-compose.yml` (service `db`,
`localhost:5432`, user/db `pricetruth`). The API connects via `DATABASE_URL`.

## Databases on this instance

| Database                    | Purpose                                          | Lifecycle                                    |
| --------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `pricetruth`                | dev database, target of `DATABASE_URL` in `.env` | wiped/migrated freely; api tests truncate it |
| `pricetruth_load`           | load/bench data (synthetic rows from loadgen)    | kept; truncated+reloaded per bench run       |
| `pricetruth_scratch`        | ad-hoc queries                                   | disposable                                   |
| `pricetruth_shadow`         | CI `migrate diff` replay target                  | recreated per run                            |
| `pricetruth_migration_test` | `test/migration.test.ts` Path A/B                | test-managed (dropped/created by tests)      |
| `pricetruth_backup_verify`  | backup-verify restore target                     | created and dropped by the script            |

Access (no local pg tools needed):

```sh
docker compose exec db psql -U pricetruth -d <db>
```

## Connection rules

- One `PrismaClient` per process (`src/db.ts`); jobs/scripts create their own
  and call `$disconnect()`.
- `DATABASE_URL` must not point at localhost when `NODE_ENV=production`
  (config `superRefine` rejects it).
- Migrations run out-of-band via `pnpm exec prisma migrate deploy` (also inside
  the API image); the API does not auto-migrate on boot — `/readiness` reports
  `migrations: pending` instead.
