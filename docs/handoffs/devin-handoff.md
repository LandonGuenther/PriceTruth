# Devin → Cursor handoff: production-backend sprint

## BASE MAIN SHA

`5e9dd67` (origin/main at branch point, includes PRs #5–#7).

## DEVIN BRANCH SHA (TBD)

Branch: `devin/production-backend-beta`. Head: TBD.

## Baseline (M0)

Fresh checkout of `origin/main` @ `5e9dd67`, `pnpm install`, Postgres 16 via `docker compose up -d db`, `prisma migrate deploy` → 7 migrations, none pending.

| Check               | Result                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm lint`         | pass                                                                                           |
| `pnpm format:check` | pass                                                                                           |
| `pnpm typecheck`    | pass                                                                                           |
| `pnpm build`        | pass                                                                                           |
| `pnpm test`         | 270 tests pass — shared 17, catalog 16, scoring 39, retailer-adapters 92, extension 24, api 82 |

## API contract changes

TBD.

## shared type changes

None — new fields are typed API-side (intersection types).

## new env vars

TBD.

## new API fields

TBD.

## deprecated fields

TBD.

## staging/production API expectations

TBD.

## extension integration actions

TBD.

## compatibility risks

TBD.

## commands after rebase

```sh
git fetch && git rebase origin/main && pnpm install && pnpm -r build && pnpm lint && pnpm typecheck && pnpm test
```
