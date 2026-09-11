# ADR-003: Provenance as a first-class DataSource entity

## Context

Every observation needs an answer to "where did this row come from?" The MVP
stored a free-form `source` text column (`extension:content-script`,
`bestbuy:products-api`, `manual`). That worked but carried no semantics: the
time policy must know whether to trust the reported timestamp, and downstream
consumers need to reason about which feeds they may legitimately redistribute.

## Decision

`DataSource` is a table keyed by a stable `key` string, with:

- `trustClass` — `CLIENT_REPORTED` | `SERVER_FETCHED` | `VERIFIED` | `TEST`.
  Drives the time policy (`resolveObservationTime`): only `CLIENT_REPORTED`
  replaces the reported time with server `receivedAt` and records clock skew.
- `redistributionReviewStatus` — `UNREVIEWED` | `REVIEWED_OK` | `REVIEWED_RESTRICTED`.
  Metadata **for counsel review; the code makes no legal determination** and does
  not gate reads on it.
- `type` (`EXTENSION`, `API`, `MANUAL`, `SYNTHETIC`) and `displayName`.

The fact row carries `dataSourceId` (FK) instead of a string. Client-ingested
observations may only claim `CLIENT_REPORTED` sources — claiming a
`SERVER_FETCHED`/`VERIFIED`/`TEST` source over `POST /v1/observations` is a 400.
Seeded by both the data-foundation migration SQL and `DATA_SOURCE_DEFINITIONS`
in `@pricetruth/shared` (the same list in both places, kept in sync manually).

## Alternatives considered

- **Free-form string (status quo).** Proliferates spellings; no place to hang
  trust or review metadata; the wire claim is indistinguishable from truth.
- **Enum column on the fact row.** Cheaper, but enums can't carry per-source
  metadata and every new source requires a schema migration.

## Consequences

- New sources = a row insert, not a migration (added to
  `DATA_SOURCE_DEFINITIONS` + seed).
- Dedup compares `dataSourceId`, so an extension row and an API row at the same
  price are distinct events — intentional.
- Unknown `source` values are rejected at ingest rather than stored.

## Future migration trigger

The first licensed or merchant feed will need per-source terms attached to
`DataSource` (or a sibling table) and, likely, redistribution-review gating in
analysis responses — promoted from inert metadata to an enforced policy.
