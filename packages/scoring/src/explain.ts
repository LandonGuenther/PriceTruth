import { PRODUCT_NAME, formatCents } from "@pricetruth/shared";

export const round1 = (x: number): number => Math.round(x * 10) / 10;

export const fmt = (cents: number, currency = "USD"): string => formatCents(cents, currency);

export function observationsReason(observationCount: number, coverageDays: number): string {
  return `${observationCount} observations across ${coverageDays} days.`;
}

export function referenceAbovePercentileReason(
  referenceCents: number,
  percentile: number,
  currency: string,
): string {
  return `The advertised ${fmt(referenceCents, currency)} reference price is above ${percentile}% of prices ${PRODUCT_NAME} has observed for this listing.`;
}

export function vsTypicalReason(
  currentCents: number,
  typicalCents: number,
  actualDiscountVsTypicalPct: number,
  currency: string,
): string {
  if (actualDiscountVsTypicalPct >= 0) {
    return `${fmt(currentCents, currency)} is ${actualDiscountVsTypicalPct}% below the typical recent price of ${fmt(typicalCents, currency)}.`;
  }
  return `${fmt(currentCents, currency)} is ${Math.abs(actualDiscountVsTypicalPct)}% above the typical recent price of ${fmt(typicalCents, currency)}.`;
}

export function aboveRecordedLowReason(
  currentCents: number,
  lowCents: number,
  currency: string,
): string {
  const pctAboveLow = lowCents > 0 ? round1((100 * (currentCents - lowCents)) / lowCents) : 0;
  if (pctAboveLow === 0) {
    return `${fmt(currentCents, currency)} matches the lowest ${PRODUCT_NAME} recorded price of ${fmt(lowCents, currency)}.`;
  }
  return `${fmt(currentCents, currency)} is ${pctAboveLow}% above the lowest ${PRODUCT_NAME} recorded price of ${fmt(lowCents, currency)}.`;
}

export function nearReferenceShareReason(share: number): string {
  return `The observed daily price was within 2% of, or above, the reference price ${share}% of the time.`;
}
