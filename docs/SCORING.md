# Scoring Specification (V1)

All scoring is deterministic and reproducible from stored observations. No ML.
Two scores are computed independently and are never merged.

## Inputs

- `observations`: **eligible** `PriceObservation`s for one listing — `synthetic
= false`, `status = 'ACCEPTED'`, and `priceType ∈ {STANDARD, SALE}`
  (`ELIGIBLE_PRICE_TYPES`). Each carries `priceCents`, optional
  `referencePriceCents`, `effectiveAt` (ISO; the server-authoritative time per
  ADR-004), and `sourceKey` (the `DataSource.key`).
- `asOf`: the timestamp the analysis is computed for (defaults to the newest
  eligible observation).
- Current price = newest eligible observation's `priceCents`.
- Current reference price = newest eligible observation's `referencePriceCents` (may be null).

All time math — "newest" ordering, day bucketing, window medians, staleness —
uses `effectiveAt`, never `clientObservedAt`.

## Daily series

Observations are collapsed to one point per UTC calendar day: the **median** of that day's
prices. All statistics except `observationCount` are computed over this daily series so one
noisy day (many observations) cannot dominate.

## Statistics (`HistoricalStats`)

| Field                                                | Definition                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `observationCount`                                   | raw count of valid observations                                                                                                 |
| `uniqueDays`                                         | number of daily points                                                                                                          |
| `coverageDays`                                       | `(lastDay - firstDay) + 1` in UTC days (0 if no data)                                                                           |
| `newestObservedAt` / `oldestObservedAt`              | ISO strings                                                                                                                     |
| `median30Cents` / `median90Cents` / `median180Cents` | median of daily points whose day is within the last N days of `asOf` (inclusive); `null` if fewer than 3 daily points in window |
| `medianAllCents`                                     | median of all daily points (`null` if 0)                                                                                        |
| `low90Cents` / `low180Cents`                         | min of daily points in window; `null` if window empty                                                                           |
| `recordedLowCents` / `recordedHighCents`             | min/max over all daily points                                                                                                   |
| `pricePercentile`                                    | `100 * count(daily < current) / uniqueDays` (0 = lowest recorded)                                                               |
| `shareAtOrBelowCurrent`                              | `100 * count(daily <= current) / uniqueDays`                                                                                    |
| `referencePricePercentile`                           | `100 * count(daily < reference) / uniqueDays`; `null` if no reference                                                           |
| `shareNearReference`                                 | `100 * count(daily >= 0.98 * reference) / uniqueDays`; `null` if no reference                                                   |

Medians use the standard midpoint definition (average of two middle values, rounded to
integer cents with `Math.round`).

## Confidence

Levels: `INSUFFICIENT < LOW < MEDIUM < HIGH`.

Base level:

- `INSUFFICIENT` if `observationCount < 3` or `uniqueDays < 3` or `coverageDays < 7`
- else `LOW` if `uniqueDays < 10` or `coverageDays < 30`
- else `MEDIUM` if `uniqueDays < 30` or `coverageDays < 90`
- else `HIGH`

Downgrades (each applies at most once, never below `INSUFFICIENT`):

- staleness: newest observation older than 14 days before `asOf` → one level down
- dispersion: `(Q3 - Q1) / medianAll > 0.5` over the daily series → one level down

Every confidence result carries `reasons: string[]` explaining the level.

Numeric scores are emitted only when confidence is not `INSUFFICIENT`. With `INSUFFICIENT`
confidence both scores return `score: null` with label `Insufficient evidence`
(or `Limited history` when there is at least one observation).

## Typical price

`typicalCents = median90Cents ?? median180Cents ?? medianAllCents`.
`typicalWindow` records which one was used ("90d" | "180d" | "all").

## Deal Score (0–100)

"Regardless of the advertisement, is the current price historically good?"

- `s1 = 100 - pricePercentile` (weight 0.4)
- `s2`: `r = (typical - current) / typical`; `s2 = clamp(50 + r * 250, 0, 100)` (weight 0.3)
  (20% below typical → 100; 20% above → 0)
- `s3`: `d = (current - recordedLow) / recordedLow`; `s3 = clamp(100 - d * 250, 0, 100)` (weight 0.3)
  (at recorded low → 100; 40% above the low → 0)
- `score = Math.round(0.4*s1 + 0.3*s2 + 0.3*s3)`

Labels:

| score | label                        |
| ----- | ---------------------------- |
| ≥ 80  | Historically strong price    |
| ≥ 60  | Better than typical          |
| ≥ 40  | Typical price                |
| ≥ 20  | Above typical                |
| < 20  | Historically expensive price |

## Discount Integrity Score (0–100)

"Does the advertised markdown have historical support?"

`advertisedDiscountPct` is a **store-reported fact** (reference vs current), not
a historical judgment: it is computed whenever a valid reference price exceeds
the current price, independent of confidence — including under `INSUFFICIENT`,
where the score and label stay null/"Limited history" but the markdown is still
reported.

If there is no reference price, or `reference <= current`: `score: null`,
label `No advertised discount`, `advertisedDiscountPct: null`.

Otherwise:

- `advertisedDiscountPct = 100 * (reference - current) / reference`
- `actualDiscountVsTypicalPct = 100 * (typical - current) / typical` (may be negative)
- `s1` reference support: `ratio = typical / reference`; `s1 = clamp((ratio - 0.6) / 0.4, 0, 1) * 100`
  (reference equal to typical → 100; reference ≥ 67% above typical → 0) (weight 0.4)
- `s2 = shareNearReference` (how often the daily price was within 2% of, or above, the reference) (weight 0.3)
- `s3 = clamp(actualDiscountVsTypicalPct / advertisedDiscountPct, 0, 1) * 100` (weight 0.3)
- `score = Math.round(0.4*s1 + 0.3*s2 + 0.3*s3)`

Labels:

| score | label                                             |
| ----- | ------------------------------------------------- |
| ≥ 70  | Strong historical support                         |
| ≥ 40  | Moderate historical support                       |
| ≥ 20  | Weak historical support                           |
| < 20  | Reference price not supported by our observations |

## Explanations

Each score returns `reasons: string[]` built from fixed templates, using neutral,
evidence-based language. Never use: scam, fraud, fake, illegal, deceptive.
Refer to lows as "lowest PriceTruth recorded price", never "all-time low".

Example templates:

- `The advertised {reference} reference price is above {referencePricePercentile}% of prices {PRODUCT_NAME} has observed for this listing.`
- `{current} is {actualDiscountVsTypicalPct}% below the typical recent price of {typical}.`
- `{current} is {pctAboveLow}% above the lowest {PRODUCT_NAME} recorded price of {low}.`
- `{observationCount} observations across {coverageDays} days.`

## Worked example (from product brief)

Reference $499, current $299, typical (90d median) $319, recorded low $259, high $349.
Advertised discount 40.1%; actual vs typical ≈ 6.3%.
Discount Integrity lands in "Reference price not supported" / "Weak" range; Deal Score in
"Better than typical" range.

Pinned in tests (`packages/scoring/src/scores.test.ts`) on a synthetic 180-day daily series
(89 days at $319 plus today at $299 in the 90-day window; 88 days at $329 plus one $259 and
one $349 day in the prior 90):

- stats: `observationCount` 180, `uniqueDays` 180, `coverageDays` 180, `median90Cents`
  31900, `medianAllCents` 31900, `recordedLowCents` 25900, `recordedHighCents` 34900,
  `pricePercentile` 0.6, `shareAtOrBelowCurrent` 1.1, `referencePricePercentile` 100,
  `shareNearReference` 0; confidence `HIGH`; typical `{ cents: 31900, window: "90d" }`.
- Discount Integrity: `advertisedDiscountPct` 40.1, `actualDiscountVsTypicalPct` 6.3,
  `score` 9, label `Reference price not supported by our observations`.
- Deal Score: `score` 78, label `Better than typical`.
