# Data Quality & Trust (M3)

Every `PriceObservation` is stored — nothing is silently dropped. What varies is
`status`, which controls eligibility for history/statistics/scoring.

## Status lifecycle

| Status         | Meaning                                                                                                                | Eligible |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| `RECEIVED`     | Transient initial state — never persisted on a row; appears only as `fromStatus` on the first `ObservationStatusEvent` | —        |
| `ACCEPTED`     | Passed validation + anomaly checks                                                                                     | yes      |
| `CORROBORATED` | Independently supported by a second source or day                                                                      | yes      |
| `QUARANTINED`  | Anomaly suspected, awaiting corroboration                                                                              | no       |
| `EXCLUDED`     | Operator decision                                                                                                      | no       |

Every insert writes one `ObservationStatusEvent` `RECEIVED → <initial>` with
machine-readable reason codes and an `actor` (`system:ingest`,
`system:anomaly@1.0.0`, `system:corroboration@1.0.0`, `cli:<name>`). All later
transitions go through `setObservationStatus` (single transaction: row update +
event). The DB trigger still forbids any non-status mutation (ADR-001).

## Eligibility

Defined once in `packages/scoring/src/eligibility.ts`:

- `ELIGIBLE_STATUSES = [ACCEPTED, CORROBORATED]`
- `ELIGIBLE_PRICE_TYPES = [STANDARD, SALE]`
- `synthetic = false`

History, analysis and anomaly context queries use these constants verbatim.
`AnalysisResponse.evidence` reports `eligibleCount` plus per-reason excluded
counts (`synthetic`, `quarantined`, `excluded`, `priceType`).

## Anomaly detection (`ANOMALY_ENGINE_VERSION = "1.0.0"`)

Pure function (`apps/api/src/services/dataQuality/anomaly.ts`) run at ingest for
CLIENT_REPORTED rows only — trusted sources are never quarantined by rules.
Context: the last ≤20 eligible, non-synthetic observations for the listing
within 30 days before the candidate's `effectiveAt`.

| Rule                          | Fires when                                                               |
| ----------------------------- | ------------------------------------------------------------------------ |
| `currency_change`             | any context currency ≠ candidate                                         |
| `large_move_vs_recent_median` | context ≥3 and \|p − median\|/median > 0.60                              |
| `contradicts_recent_cluster`  | context ≥5, spread (max−min)/median ≤ 0.05, \|p − median\|/median > 0.25 |
| `rapid_oscillation`           | ≥3 direction changes of ≥20% each within the last 24h                    |

A QUARANTINE verdict still inserts the row — status `QUARANTINED` and the
reasons on the status event. No absolute price ceilings anywhere.

## Corroboration (`CORROBORATION_ENGINE_VERSION = "1.0.0"`)

`corroborateListing` runs inline at the end of every ingest for that listing —
idempotent, no queue. A non-synthetic `ACCEPTED`/`QUARANTINED` row (last 30
days) becomes `CORROBORATED` when another non-synthetic, non-`EXCLUDED` row for
the same listing agrees on price within 1% AND is either from a different
DataSource or on a different UTC day (`effectiveAt`). `EXCLUDED` rows are never
touched. This is how a genuine price drop self-heals: a second day or source
confirms it and the row re-enters analysis as CORROBORATED.

## Known limitations

- A QUARANTINED row can be corroborated by _another QUARANTINED row_ — including
  one from the same source on a different UTC day — so a single client posting a
  poisoned price on ≥2 days can heal it. Mitigation is PLANNED: require a
  different DataSource or an installation-level signal (installation IDs are
  deliberately NOT implemented — see docs/PRIVACY.md).

## IMPLEMENTED vs PLANNED

IMPLEMENTED: status lifecycle + actor audit, centralized eligibility, anomaly
rules above, inline corroboration, validation hardening (host/format/lengths/
Int32 bound/reference>price), 64KB body limit, sanitized 5xx.

PLANNED: a review queue/ops surface for QUARANTINED rows (today only the DB +
events expose them), scheduled corroboration sweeps.

FUTURE / deliberately NOT implemented: installation IDs or any per-client
identity for throttling (see docs/PRIVACY.md), cross-listing poison detection.
