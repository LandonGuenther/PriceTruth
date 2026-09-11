# Catalog Identity

How PriceTruth decides whether two retailer listings are the same canonical
`Product`. Deterministic, auditable, conservative: we only link on strong
identifier evidence — never on titles.

## Concept mapping

- **ProductFamily** — a product line ("Sony WH-1000XM6"). Exists in the schema
  (`Product.familyId`); **population is PLANNED — families are created manually
  or by a future family-resolution job.**
- **Product** — the canonical _variant-level_ purchasable product ("WH-1000XM6,
  Black / US"). `Product` plays the ProductVariant role; `ListingVariant`
  (the page-level option selection like size/color) is a different concept and
  stays unchanged.
- **Listing** — `(retailer, externalId)`; `productId` points at a Product.

## IMPLEMENTED

### Assertions

Every incoming observation asserts identifiers about its listing, stored as
`IdentifierAssertion(listingId, type, rawValue, normalizedValue, valid,
dataSourceId, status, firstSeenAt, lastSeenAt)`:

- retailer `externalId` → `ASIN` / `BESTBUY_SKU`
- `gtin` → `GTIN`
- `modelNumber` → `MANUFACTURER_MODEL`

Normalisation (`@pricetruth/catalog`, pure):

- GTIN/UPC/EAN → digits stripped, GS1 mod-10 check digit validated, normalized
  to a 14-digit GTIN. Invalid check digit → `valid: false` (normalized still
  defined so identical-but-invalid values can be compared).
- ASIN → trim + uppercase, valid iff `^[A-Z0-9]{10}$`.
- BESTBUY_SKU → trim, valid iff `^\d{1,12}$`.
- MPN / MANUFACTURER_MODEL → trim, collapse whitespace, uppercase. Separators
  are kept in `normalizedValue`; matching uses
  `mpnMatchKey()` (separators `[-_/ .]` removed).
- `normalizeBrand()`: lowercase, collapse whitespace, drop trailing
  inc/llc/ltd/corp.
- `detectCondition(title)`: `NEW`/`REFURBISHED`/`USED`/`UNKNOWN` from word
  tokens (renewed/refurbished → REFURBISHED; pre-owned/used/open-box → USED;
  new → NEW; else UNKNOWN).

### Match engine (`evaluateMatch`, engine version 1.0.0)

Candidate products are found via `ProductIdentifier` on normalized values:
GTIN-family by normalized value; MPN/MANUFACTURER_MODEL by `mpnMatchKey` —
`ProductIdentifier.value` for model types stores the match key, so the lookup
is a plain index hit. In order:

1. **condition_mismatch** — known-and-different title conditions exclude a
   candidate product.
2. Strong signals: `gtin_exact` (valid GTIN equal) or `brand_model_exact`
   (normalized brand equal AND model match-key equal).
3. GTIN → A and brand+model → B (A ≠ B) → **CONFLICT**, no link.
4. Exactly one `gtin_exact` → **EXACT** → auto-link.
5. Exactly one `brand_model_exact` (no GTIN evidence against) → **HIGH** →
   auto-link.
6. Equal-but-invalid GTIN (`gtin_invalid`) or model equal without matching
   brand (`model_only`) → **REVIEW**, no link. Ambiguous multi-product
   GTIN/brand-model matches also land here (`gtin_ambiguous` /
   `brand_model_ambiguous`).
7. Title similarity is never a signal.
8. Otherwise **UNRESOLVED**.

Every evaluation writes a `MatchEvidence` row (level, reasons, engine version).
`shouldAutoLink` = EXACT | HIGH only.

### Ingest integration

- New listing: assertions → match → auto-link (+ `ProductLinkEvent` with actor
  `auto:match-engine@1.0.0`, reason `match:<LEVEL>`), else a fresh 1:1 Product.
  Newly discovered valid identifiers are added to the product (skip on
  `[type, value]` conflict).
- Existing listing: assertions are upserted (`lastSeenAt` bumped); when a new
  `(type, normalizedValue)` appears the match is re-run for evidence only — an
  already-linked listing is **never auto-relinked**.

### Manual corrections

`linkListing` / `unlinkListing` (in `catalogService`) update `productId` inside
a transaction and append a `ProductLinkEvent` (`previous`/`new` ids, reason,
actor). Unlink creates a fresh 1:1 Product carrying the listing's valid
assertions.

CLI:

```sh
pnpm --filter @pricetruth/api catalog show <retailer> <externalId>
pnpm --filter @pricetruth/api catalog link <retailer> <externalId> <productId> --reason "..." --actor <name>
pnpm --filter @pricetruth/api catalog unlink <retailer> <externalId> --reason "..." --actor <name>
```

### Migration backfill

`20260911064203_catalog_identity` + `…04_catalog_identity_model_backfill`:
for each existing Listing, ACTIVE assertions are created from `externalId`/
`gtin`/`modelNumber` with dataSource `extension:content-script`, and existing
`ProductIdentifier` values are normalized (GTIN → 14-digit, ASIN → uppercase).
The model backfill is a separate migration because a newly-added enum value
can't be used in the same transaction that adds it.

## PLANNED

- **ProductFamily population** — families are not auto-created; `familyId`
  stays null until a family-resolution step exists.
- **Review queue** — REVIEW/CONFLICT evidence is recorded but nothing surfaces
  it yet.

## FUTURE

- Retailer feeds / licensed data asserting identifiers directly into
  `IdentifierAssertion` with their own `DataSource` (trust classes apply — see
  ADR-003).
