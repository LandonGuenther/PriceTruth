# ADR-001: Price observations are append-only facts

## Context

PriceTruth's value is that its price history cannot be quietly edited after the
fact. If a retailer's claimed discount is contradicted by recorded observations,
those observations must be durable. A mutable fact table — even one mutated only
through application code — leaves the integrity of the record dependent on code
review discipline alone.

The MVP already treated observations as append-only by convention: the API
exposed no update or delete path. As the schema grew (variants, provenance,
lifecycle status) we needed the guarantee to survive bugs, not just intent.

## Decision

`PriceObservation` is immutable at the database layer, enforced by the
`pricetruth_forbid_observation_mutation()` trigger:

- `DELETE` raises an exception. Always.
- `UPDATE` raises an exception if any column other than `status` differs between
  OLD and NEW.

`status` is the single mutable column, and only through
`setObservationStatus(prisma, id, toStatus, reason)`, which performs the update
and appends an `ObservationStatusEvent` (`fromStatus`, `toStatus`, `reason`,
timestamp) in one transaction. The event log is itself append-only. No HTTP
route exposes status changes — it is an internal/ops primitive.

Corrections are always expressed as new observations plus, where appropriate, a
status transition on the row being superseded (`QUARANTINED`, `EXCLUDED`).

## Alternatives considered

- **Soft-delete flag.** A `deleted` boolean is still a mutation of the fact row;
  it also silently changes history for queries that forget the predicate.
- **Corrections table only.** Recording deltas elsewhere makes the primary fact
  table readable as either mutable or ambiguous — every consumer must know to
  join.
- **No DB guard (application convention only).** Cheap, but one missed `update`
  or a future ORM abstraction silently breaks the invariant. The trigger makes
  violations loud (an exception) rather than invisible.

## Consequences

- Tests cannot `deleteMany()` observations; they truncate or flip status.
- The trigger's ROW comparison must be maintained if columns are added or
  removed — a migration checklist item.
- Space grows monotonically; dedup (±60 min, same price/source) bounds the
  common write amplification.

## Future migration trigger

Regulatory deletion requests (e.g. a deletion requirement covering personal or
otherwise expungeable data) would force a documented redaction procedure — most
likely rewriting column values under a privileged role rather than deleting —
and that procedure is where the trigger would be consciously bypassed, logged,
and audited. Today no personal data is stored on the row.
