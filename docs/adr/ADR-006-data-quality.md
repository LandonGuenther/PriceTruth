# ADR-006: Data quality — status lifecycle, anomaly quarantine, corroboration

## Context

Client-reported DOM extraction can be wrong (page structure changes, variant
confusion, markup tricks) or hostile. Deleting bad rows violates the
append-only model (ADR-001); storing them unfiltered poisons history and both
scores.

## Decision

- `ObservationStatus` gains `RECEIVED` (transient; only `fromStatus` on the
  insert event) and `CORROBORATED` (eligible). Every insert writes a
  `RECEIVED → <initial>` `ObservationStatusEvent`; the table gains a required
  `actor` column (`system:ingest`, `system:anomaly@<ver>`,
  `system:corroboration@<ver>`, `cli:<name>`; pre-existing rows backfilled
  `system:legacy`).
- Eligibility is defined once in `packages/scoring/src/eligibility.ts`
  (`ELIGIBLE_STATUSES`, `ELIGIBLE_PRICE_TYPES`, `isEligibleForAnalysis`,
  `ineligibilityReason`) and used verbatim by DB queries and the
  `AnalysisResponse.evidence` summary.
- A pure anomaly engine (`ANOMALY_ENGINE_VERSION = "1.0.0"`, four relative
  rules, no absolute ceilings) may move CLIENT_REPORTED rows straight to
  QUARANTINED at insert. Trusted sources are never quarantined. Rows are never
  dropped.
- Inline, idempotent `corroborateListing` promotes ACCEPTED/QUARANTINED rows
  to CORROBORATED when a second source or a different UTC day agrees on price
  within 1%. QUARANTINED → CORROBORATED is the self-heal path; EXCLUDED is
  never touched.
- Validation hardened at the wire schema: per-retailer `externalId` format,
  URL hostname must belong to the retailer, field length/count bounds, Int32
  price bound, `referencePriceCents > priceCents`, 64 KB body limit, and 5xx
  responses are a fixed generic body.

## Alternatives considered

- **Delete/reject bad rows** — loses evidence and violates append-only.
- **Score-time filtering only** — leaves poisoned rows indistinguishable; an
  explicit status column + audit log is inspectable and reversible.
- **Async/queued corroboration** — unnecessary at current volume; the inline
  per-listing pass is cheap and keeps correctness immediate.
- **Absolute price ceilings** — rejected: legitimate prices vary by orders of
  magnitude; all rules are relative to the listing's own recent history.
- **Per-client identity for abuse control** — deliberately not implemented
  (privacy); see docs/PRIVACY.md.

## Consequences

Bad data is contained without deletion and can recover automatically; every
transition is auditable with actor and versioned engine. Ingest does two extra
queries (context + corroboration pass) per observation — acceptable today.

## Future migration trigger

If ingest latency becomes an issue or corroboration must span sources arriving
hours apart, move `corroborateListing` to a scheduled job. If abuse requires
rate limiting, prefer short-lived request-scoped limits over persisted client
identity. A v2 anomaly rule set would bump `ANOMALY_ENGINE_VERSION` in the
event actor string, keeping old events interpretable.
