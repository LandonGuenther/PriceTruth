/** Price types eligible for history/scoring (retailer-agnostic eligibility). */
export const ELIGIBLE_PRICE_TYPES = ["STANDARD", "SALE"] as const;

export interface ScoringObservation {
  priceCents: number;
  referencePriceCents: number | null;
  effectiveAt: string;
  sourceKey: string;
}

export interface DailyPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  medianPriceCents: number;
}
