# ADR-005: Catalog identity — assertion facts, evidence log, conservative auto-link

## Context

The MVP created a `Product` 1:1 per `Listing`, so the same product sold at
Amazon and Best Buy — or relisted under a different page id — produced
duplicate canonical products with no way to reconcile them. Correct product
identity is the foundation everything else sits on: history and scores are only
meaningful when observations belong to the right product.

Two requirements shaped the design: (a) merges must be defensible — a wrong
merge contaminates two products' histories — and (b) every link decision must be
auditable after the fact.

## Decision

- `Product` = the canonical _variant-level_ product ("Black / US"). New
  `ProductFamily` above it is schema-only for now (population is PLANNED).
- `IdentifierAssertion` records each identifier a data source has asserted
  about a listing, normalized and validity-checked (`@pricetruth/catalog`:
  GTIN mod-10, ASIN/SKU formats, model match keys, brand normalization).
  Upserted on every observation; `status` supports RETRACTED.
- `evaluateMatch` decides links on strong signals only — valid GTIN equality
  (EXACT) or normalized brand + model match-key (HIGH). Weak signals produce
  REVIEW evidence; contradictory signals produce CONFLICT; title similarity is
  never a signal. Only EXACT/HIGH auto-link, and only for new listings.
- Every evaluation writes `MatchEvidence`; every productId change writes a
  `ProductLinkEvent` (auto engine or `cli:<name>` actor). Manual
  `link`/`unlink` via `pnpm catalog` CLI; unlink spins off a fresh 1:1 product.
- No-match listings keep the MVP's 1:1 product fallback.

## Alternatives considered

- **Title/fuzzy matching.** Fast but unreviewable — fuzzy links would corrupt
  history silently. Titles are excluded as a signal by rule.
- **Block-level dedup keys** (e.g. canonical (brand, model) unique constraint).
  Loses the ability to record disagreement and forces auto-merge decisions into
  constraint violations.
- **Human review before any link.** Safe but blocks the common case (identical
  GTIN) that is effectively unambiguous.
- **Mutable canonical mapping table.** A `listing→product` mapping with no
  event log would erase the audit trail; link/unlink corrections are instead
  first-class events.

## Consequences

- Listings can stay UNRESOLVED/REVIEW until evidence arrives — correct.
- `ProductIdentifier.value` for MPN/MANUFACTURER_MODEL stores the match key
  (separators stripped), not the display form — documented and intentional.
- Match rules live in `MATCH_ENGINE_VERSION`; a rules change bumps the version
  so old evidence is interpretable.

## Future migration trigger

- A product _split_ (one product wrongly absorbing two listings) needs a split
  tool — today only link/unlink exist.
- A ProductFamily-resolution job will need its own evidence table pattern and
  an ADR for family-level matching rules.
- First merchant/licensed feed with richer identifiers (e.g. authoritative
  GTIN→model mappings) may add new assertion types and bump the engine version.
