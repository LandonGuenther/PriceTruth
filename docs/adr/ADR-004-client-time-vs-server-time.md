# ADR-004: Server time is authoritative for client-reported observations

## Context

The extension reports `observedAt` — a timestamp minted by a clock the server
cannot verify. Clients may be wrong (skewed clocks, timezone bugs) or hostile
(backdating a price to fabricate a price-drop history). Dedup, history, and
scoring all consume a single timestamp; which one it is matters.

## Decision

Each fact row carries three times and a recorded skew:

- `receivedAt` — server ingestion time, always server-minted.
- `clientObservedAt` — what the client reported (wire `observedAt`), stored
  untrusted.
- `effectiveAt` — the timestamp dedup, history, scoring, and "current price"
  all use.
- `clientSkewSeconds` — `clientObservedAt − receivedAt`, for skew monitoring.

Policy (`resolveObservationTime`, a pure function):

- `CLIENT_REPORTED` sources: `effectiveAt = receivedAt`; the skew is stored.
  Reported times more than 10 min in the future or more than 7 days old are
  rejected outright (400 `invalid_observation`).
- `SERVER_FETCHED` / `VERIFIED` / `TEST`: `effectiveAt = clientObservedAt ??
receivedAt` — a trusted component generated the timestamp; skew is null.

## Alternatives considered

- **Trust the client clock.** Simple, but silently corrupts history on clock
  skew and is trivially fabricable.
- **Clamp instead of reject.** Mapping out-of-range times onto the boundary
  loses signal and still admits synthetic-looking history near the bound.
- **Drop client time entirely.** Loses the diagnostic value of skew (detecting
  a broken client population) for zero gain — storage is cheap.

## Consequences

- An honest client's `observedAt` is preserved for debugging even though it
  never drives analysis.
- Dedup windows run on `effectiveAt` — a burst of backdated submissions lands
  at the same `effectiveAt` and dedups rather than spamming rows.
- The 10-minute future bound tolerates ordinary skew; the 7-day bound bounds
  replay/fabrication.

## Future migration trigger

An offline-capable extension that queues observations while offline would
require trusting queued `clientObservedAt` — that needs a signed/trusted queue
design (attested batch timestamps or equivalent), not a relaxation of this
policy.
