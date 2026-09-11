export interface ScoringObservation {
  priceCents: number;
  referencePriceCents: number | null;
  observedAt: string;
  source: string;
}

export interface DailyPoint {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  medianPriceCents: number;
}
