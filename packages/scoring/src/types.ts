// Moved to eligibility.ts — re-exported here to avoid churn.
export { ELIGIBLE_PRICE_TYPES } from "./eligibility.js";

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
